"""Derive a faster, equivalent-weight graph from the bundled quantized model.

The bundled ``kokoro-quantized.onnx`` quantizes every convolution dynamically:

    x -> DynamicQuantizeLinear -> ConvInteger(x_q, W_q, x_zp, w_zp)
      -> (+ round(bias / (x_scale * w_scale)))  -> Cast -> Mul(x_scale * w_scale)

onnxruntime's ConvInteger CPU kernel is slow: on the 4-core build machine it was
85% of inference time (RTF ~1.0). This module rewrites each such chain into

    x -> Conv(x, W, bias)   with   W = (W_q - w_zp) * w_scale   (float32)

W holds exactly the same 8-bit weight values, dequantized; the float bias is the
graph's own ``*.bias`` initializer. The only numerical difference is that the
activations entering those convolutions are no longer rounded to 8 bits (and the
bias is not floored), so the result is closer to the original float model, not
further from it. MatMulInteger, DynamicQuantizeLSTM and everything else are
left untouched. The transform is deterministic; its output hash is recorded in
the build manifest next to the source model hash.
"""

from __future__ import annotations

import collections
import json
from pathlib import Path

import numpy as np

from . import paths
from .model import sha256_file

DERIVED_DIR = paths.CACHE / "model" / "derived"
TRANSFORM_VERSION = "convinteger-to-conv/2+durations"
# Per-token durations (in 600-sample frames, pads included) from the duration
# predictor, exposed as an extra graph output. Adding an output changes nothing
# in the computation of the waveform.
DURATION_OUTPUT = "/encoder/Clip_output_0"


def derived_path(source_sha256: str) -> Path:
    return DERIVED_DIR / f"kokoro-{source_sha256[:16]}-float-conv.onnx"


def build(source: Path, dest: Path) -> dict:
    import onnx
    from onnx import helper, numpy_helper

    m = onnx.load(str(source))
    g = m.graph
    inits = {i.name: i for i in g.initializer}
    producer = {o: n for n in g.node for o in n.output}
    consumers: dict[str, list] = collections.defaultdict(list)
    for n in g.node:
        for i in n.input:
            consumers[i].append(n)

    def only(nodes, op):
        if len(nodes) != 1 or nodes[0].op_type != op:
            raise ValueError(f"unexpected pattern: {[x.op_type for x in nodes]} (wanted {op})")
        return nodes[0]

    def init_array(name):
        return numpy_helper.to_array(inits[name])

    new_nodes: dict[int, object] = {}   # index of the ConvInteger node -> replacement Conv
    removed: set[int] = set()
    new_inits = []
    index = {id(n): k for k, n in enumerate(g.node)}
    converted = 0
    for n in list(g.node):
        if n.op_type != "ConvInteger":
            continue
        dql = producer[n.input[0]]
        if dql.op_type != "DynamicQuantizeLinear":
            raise ValueError(f"{n.name}: input not from DynamicQuantizeLinear")
        x = dql.input[0]
        wq = init_array(n.input[1])
        wzp = init_array(n.input[3]) if len(n.input) > 3 and n.input[3] else np.array(0, dtype=wq.dtype)
        nxt = consumers[n.output[0]]
        bias_name = None
        if len(nxt) == 1 and nxt[0].op_type == "Add":
            add = nxt[0]
            # Add(acc, Reshape(Cast(Floor(Div(bias, x_scale*w_scale)))))
            reshape = producer[add.input[1]]
            cast_b = producer[reshape.input[0]]
            floor = producer[cast_b.input[0]]
            div = producer[floor.input[0]]
            if [reshape.op_type, cast_b.op_type, floor.op_type, div.op_type] != ["Reshape", "Cast", "Floor", "Div"]:
                raise ValueError(f"{n.name}: unexpected bias pattern")
            bias_name = div.input[0]
            if bias_name not in inits:
                raise ValueError(f"{n.name}: bias is not an initializer")
            cast = only(consumers[add.output[0]], "Cast")
            chain = [add, cast]
        else:
            cast = only(nxt, "Cast")
            chain = [cast]
        mul = only(consumers[cast.output[0]], "Mul")
        scale_node = producer[mul.input[1]]
        if scale_node.op_type != "Mul":
            raise ValueError(f"{n.name}: unexpected scale pattern")
        w_scale_names = [i for i in scale_node.input if i in inits]
        if len(w_scale_names) != 1 or dql.output[1] not in scale_node.input:
            raise ValueError(f"{n.name}: scale is not x_scale * w_scale")
        ws = init_array(w_scale_names[0]).astype(np.float64)
        if ws.size != 1 or wzp.size != 1:
            raise ValueError(f"{n.name}: per-channel quantization not handled")
        w = ((wq.astype(np.int32) - int(wzp)) * ws).astype(np.float32)
        w_name = f"{n.name}/dequantized_weight"
        new_inits.append(numpy_helper.from_array(w, w_name))
        attrs = {a.name: helper.get_attribute_value(a) for a in n.attribute}
        conv = helper.make_node(
            "Conv", [x, w_name] + ([bias_name] if bias_name else []), [mul.output[0]],
            name=n.name.replace("_quant", "_float"), **attrs,
        )
        new_nodes[index[id(n)]] = conv
        for dead in chain + [mul]:
            removed.add(index[id(dead)])
        converted += 1

    nodes = []
    for k, n in enumerate(g.node):
        if k in new_nodes:
            nodes.append(new_nodes[k])
        elif k not in removed:
            nodes.append(n)
    # Drop nodes whose outputs nobody uses any more (DynamicQuantizeLinear, bias
    # quantization, scale products), repeating until stable.
    graph_outputs = {o.name for o in g.output}
    while True:
        used = {i for n in nodes for i in n.input} | graph_outputs
        keep = [n for n in nodes if any(o in used for o in n.output if o)]
        if len(keep) == len(nodes):
            break
        nodes = keep
    used = {i for n in nodes for i in n.input}
    initializers = [i for i in list(g.initializer) + new_inits if i.name in used]
    del g.node[:]
    g.node.extend(nodes)
    del g.initializer[:]
    g.initializer.extend(initializers)
    add_duration_output(m)
    m.producer_name = "fab-one-narration/derive.py"
    m.producer_version = TRANSFORM_VERSION
    onnx.checker.check_model(m, full_check=False)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    onnx.save(m, str(tmp))
    tmp.replace(dest)
    return {"converted_convs": converted, "nodes": len(nodes)}


def add_duration_output(m) -> bool:
    """Expose the duration predictor's rounded, clipped per-token frame counts."""
    from onnx import TensorProto, helper

    if any(o.name == DURATION_OUTPUT for o in m.graph.output):
        return True
    if not any(DURATION_OUTPUT in n.output for n in m.graph.node):
        return False
    # float [1, tokens + 2]: Round -> Clip of the predicted durations
    m.graph.output.append(helper.make_tensor_value_info(DURATION_OUTPUT, TensorProto.FLOAT, [1, "n_tokens_padded"]))
    return True


def with_duration_output(source: Path) -> bytes:
    """The bundled graph, unchanged except for the extra duration output (in memory)."""
    import onnx

    m = onnx.load(str(source))
    add_duration_output(m)
    return m.SerializeToString()


def ensure(source: Path, source_sha256: str) -> tuple[Path, str]:
    """Return (path, sha256) of the derived model, building it once if needed."""
    dest = derived_path(source_sha256)
    meta = dest.with_suffix(".json")
    if dest.exists() and meta.exists():
        info = json.loads(meta.read_text())
        if info.get("transform") == TRANSFORM_VERSION and info.get("source_sha256") == source_sha256:
            return dest, info["sha256"]
    stats = build(source, dest)
    info = {"transform": TRANSFORM_VERSION, "source_sha256": source_sha256,
            "sha256": sha256_file(dest), "bytes": dest.stat().st_size, **stats}
    meta.write_text(json.dumps(info, indent=2) + "\n")
    return dest, info["sha256"]
