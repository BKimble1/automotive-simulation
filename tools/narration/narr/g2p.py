"""Audio-only text preparation and G2P for Kokoro v1.0 British voices (bm_*/bf_*).

Captions are never changed. Each cue's caption text goes through these steps to
produce the phoneme string the model reads:

1. Pronunciation dictionary (``pronunciations.json``). A ``say`` entry substitutes a
   respelling into the audio text. A ``phonemes`` entry pins the phonemes of that
   word or phrase (Kokoro/misaki symbols, British set), optionally per part of
   speech.
2. Number normalisation: any digits left over become British English words
   ("193" -> "one hundred and ninety-three", "13.5" -> "thirteen point five").
3. misaki 0.9.4 British lexicon (gold, then silver entries), using misaki's own
   rules for stress, "the"/"a"/"to" reduction, suffixes (-s, -ed, -ing) and
   punctuation. misaki normally tokenises and tags with spaCy's en_core_web_sm,
   which is only distributed through GitHub (blocked here), so this module
   supplies a small regex tokenizer and a heuristic part-of-speech tagger that
   covers what misaki's rules look at (determiners, prepositions, punctuation,
   noun/verb heteronyms).
4. Words the lexicon does not know go to misaki's EspeakFallback: espeak-ng
   (en-gb, via phonemizer-fork + espeakng-loader) mapped to Kokoro's symbols.

Kokoro v1.0 was trained on misaki phonemes, so this keeps the model's input in
the distribution it was trained on for everything except espeak fallbacks.
"""

from __future__ import annotations

import importlib.metadata as md
import json
import re
import sys
import types
from dataclasses import dataclass, field
from pathlib import Path

# misaki.en imports spaCy at module level but only uses it to download/load a
# trained pipeline and to align inline [word](/phonemes/) markup. Both are replaced
# below, so a stub module is enough when spaCy is not installed.
import importlib.util  # noqa: E402

if importlib.util.find_spec("spacy") is None:  # pragma: no cover - depends on the environment
    sys.modules["spacy"] = types.ModuleType("spacy")

from misaki import en as misaki_en  # noqa: E402
from misaki.espeak import EspeakFallback  # noqa: E402
from misaki.token import MToken  # noqa: E402
from num2words import num2words  # noqa: E402

from . import paths  # noqa: E402

G2P_VERSION = "2026-09-23.1"
# misaki's GB_VOCAB omits ɐ, which its own rules emit for a reduced "a"; it is in the model vocab.
GB_SYMBOLS = frozenset(misaki_en.GB_VOCAB) | frozenset(misaki_en.PUNCTS) | frozenset(" ()ᵊɐ")

SLOT_OPEN, SLOT_CLOSE = "\ue000", "\ue001"  # private-use markers for pinned words
SLOT_RE = re.compile(f"{SLOT_OPEN}(\\d+){SLOT_CLOSE}")


# ---------------------------------------------------------------------------------
# Pronunciation dictionary
# ---------------------------------------------------------------------------------
@dataclass
class Entry:
    key: str
    say: str | None
    phonemes: str | dict | None
    case_sensitive: bool
    note: str = ""
    asr: tuple[str, ...] = ()   # transcriptions the ASR check accepts (QA only)

    def spec(self) -> dict:
        """What the cache key records for this entry (everything that shapes the audio)."""
        d = {"key": self.key, "caseSensitive": self.case_sensitive}
        if self.say is not None:
            d["say"] = self.say
        if self.phonemes is not None:
            d["phonemes"] = self.phonemes
        return d


class PronunciationDictionary:
    """Whole-word (or whole-phrase) substitutions applied to the AUDIO text only."""

    def __init__(self, path: Path = paths.PRONUNCIATIONS):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("format") != 1:
            raise SystemExit(f"{path}: unsupported format {data.get('format')!r}")
        self.path = Path(path)
        self.entries: list[Entry] = []
        for key, spec in data["entries"].items():
            if key.startswith("//"):
                continue  # comment keys
            if not isinstance(spec, dict):
                raise SystemExit(f"{path}: entry {key!r} must be an object")
            has_say, has_ph = "say" in spec, "phonemes" in spec
            if has_say == has_ph:
                raise SystemExit(f"{path}: entry {key!r} needs exactly one of 'say' or 'phonemes'")
            ph = spec.get("phonemes")
            for p in ([ph] if isinstance(ph, str) else list((ph or {}).values())):
                bad = sorted({c for c in p if c not in GB_SYMBOLS})
                if bad:
                    raise SystemExit(f"{path}: entry {key!r} uses symbols outside the British set: {bad}")
            if isinstance(ph, dict) and "DEFAULT" not in ph:
                raise SystemExit(f"{path}: entry {key!r} phonemes object needs a DEFAULT")
            cs = spec.get("caseSensitive", any(c.isupper() for c in key))
            self.entries.append(Entry(key, spec.get("say"), ph, bool(cs), spec.get("note", ""),
                                      tuple(spec.get("asr", ()))))
        self.entries.sort(key=lambda e: (-len(e.key), e.key))
        alts = []
        for i, e in enumerate(self.entries):
            body = re.escape(e.key).replace(r"\ ", r"\s+")
            alts.append(f"(?P<e{i}>{body})" if e.case_sensitive else f"(?P<e{i}>(?i:{body}))")
        # Word boundaries that also refuse to split a decimal number ("0.193"). An
        # alphabetic key also matches with an inflection: plural/possessive (-s, -es,
        # -'s, -s'), -ed, -ing. Phoneme entries get misaki's suffix rules for these.
        self.regex = re.compile(
            r"(?<![\w])(?<!\d\.)(?:" + "|".join(alts) + r")"
            r"(?P<sfx>['’]s|s['’]|es|s|ed|ing)?(?![\w])(?!\.\d)"
        )

    def apply(self, text: str) -> tuple[str, list[Entry], list[tuple[Entry, str]]]:
        """Return (audio text with phoneme slots, entries used, (slot entry, suffix))."""
        used: list[Entry] = []
        slots: list[tuple[Entry, str]] = []

        def repl(m: re.Match) -> str:
            name = next(k for k, v in m.groupdict().items() if v is not None and k != "sfx")
            e = self.entries[int(name[1:])]
            sfx = m.group("sfx") or ""
            if sfx and not e.key.isalpha():
                return m.group(0)  # inflections only for plain words
            used.append(e)
            if e.say is not None:
                return e.say + sfx
            slots.append((e, sfx))
            return f"{SLOT_OPEN}{len(slots) - 1}{SLOT_CLOSE}"

        out = self.regex.sub(repl, text)
        # A pinned word glued to a hyphenated compound ("CMOS-based") is read as two words.
        out = re.sub(f"(?<={SLOT_CLOSE})-(?=\\w)", " ", out)
        out = re.sub(f"(?<=\\w)-(?={SLOT_OPEN})", " ", out)
        return out, used, slots


# ---------------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------------
NUM_RE = re.compile(
    rf"(?<![\w{SLOT_OPEN}.])(\d{{1,3}}(?:,\d{{3}})+|\d+)(?:\.(\d+))?(st|nd|rd|th)?(%)?(?![\w{SLOT_CLOSE}])"
)


def number_words(int_part: str, frac: str | None, ordinal: str | None, pct: str | None) -> str:
    n = int(int_part.replace(",", ""))
    if ordinal:
        words = num2words(n, to="ordinal", lang="en")
    elif frac is None and len(int_part) == 4 and 1100 <= n <= 2099:
        words = num2words(n, to="year", lang="en")  # 1959 -> nineteen fifty-nine
    else:
        words = num2words(n, lang="en")  # British: "one hundred and ninety-three"
    if frac is not None:
        words += " point " + " ".join(num2words(int(d), lang="en") for d in frac)
    if pct:
        words += " per cent"
    return words.replace(",", "")


def normalise_numbers(text: str) -> str:
    return NUM_RE.sub(lambda m: number_words(*m.groups()), text)


# ---------------------------------------------------------------------------------
# Tokenizer + heuristic tagger (replaces spaCy for misaki)
# ---------------------------------------------------------------------------------
LEAD_PUNCT = "\"“‘([«"
TRAIL_PUNCT = ".,;:!?…\"”)]»—–"
DT_WORDS = {"a", "an", "the", "this", "these", "those", "each", "every", "another", "no",
            "some", "any", "all", "both", "either", "neither"}
PRPS_WORDS = {"its", "their", "our", "your", "my", "his", "her"}
PRP_WORDS = {"i", "it", "they", "we", "you", "he", "she", "them", "us", "him", "me"}
OBJ_PRONOUNS = {"it", "them", "us", "him", "her", "me"}
IN_WORDS = {"in", "on", "at", "of", "for", "from", "with", "by", "into", "onto", "through",
            "across", "under", "over", "between", "after", "before", "during", "without",
            "within", "about", "against", "along", "around", "behind", "below", "beneath",
            "beside", "beyond", "near", "off", "since", "toward", "towards", "upon", "via",
            "than", "until", "underneath", "as", "if", "because", "while", "whether",
            "though", "although", "per"}
CC_WORDS = {"and", "or", "but", "nor"}
MD_WORDS = {"can", "could", "will", "would", "shall", "should", "may", "might", "must"}
VERBISH = {"is", "was", "are", "were", "be", "been", "being", "do", "does", "did", "has",
           "have", "had", "make", "makes", "see", "sees", "finish", "finishes", "complete",
           "completes", "repeat", "repeats", "remove", "removes", "use", "uses"}


def _split_chunk(chunk: str) -> list[str]:
    parts: list[str] = []
    for piece in re.split(f"({SLOT_OPEN}\\d+{SLOT_CLOSE}|—|–|…|\\.\\.\\.)", chunk):
        if not piece:
            continue
        if SLOT_RE.fullmatch(piece) or piece in ("—", "–", "…", "..."):
            parts.append("…" if piece == "..." else piece)
            continue
        lead, trail = [], []
        while piece and piece[0] in LEAD_PUNCT:
            lead.append(piece[0])
            piece = piece[1:]
        while piece and piece[-1] in TRAIL_PUNCT:
            trail.insert(0, piece[-1])
            piece = piece[:-1]
        parts += lead + ([piece] if piece else []) + trail
    return parts


def tokenize_words(text: str) -> list[tuple[str, str]]:
    """Split text into (token, following whitespace) pairs, spaCy-style."""
    out: list[tuple[str, str]] = []
    for m in re.finditer(r"(\S+)(\s*)", text):
        parts = _split_chunk(m.group(1))
        for j, p in enumerate(parts):
            out.append((p, (" " if m.group(2) else "") if j == len(parts) - 1 else ""))
    return out


def _closed_tag(tok: str, prev_ws: bool, i: int) -> str | None:
    low = tok.lower()
    if all(c in ".!?" for c in tok):
        return "."
    if tok == ",":
        return ","
    if tok in (";", ":", "—", "–", "…", "-"):
        return ":"
    if tok in ('"', "“"):
        return "``" if (i == 0 or prev_ws or tok == "“") else "''"
    if tok == "”":
        return "''"
    if tok in ("(", "["):
        return "-LRB-"
    if tok in (")", "]"):
        return "-RRB-"
    if low in DT_WORDS:
        return "DT"
    if low in PRPS_WORDS:
        return "PRP$"
    if low in PRP_WORDS:
        return "PRP"
    if low == "to":
        return "TO"
    if low in IN_WORDS:
        return "IN"
    if low in CC_WORDS:
        return "CC"
    if low in MD_WORDS:
        return "MD"
    if re.fullmatch(r"[\d.,]+", tok):
        return "CD"
    return None


def tag_tokens(toks: list[tuple[str, str]]) -> list[str]:
    tags: list[str | None] = []
    for i, (t, _) in enumerate(toks):
        prev_ws = i > 0 and bool(toks[i - 1][1])
        tags.append(_closed_tag(t, prev_ws, i))
    final: list[str] = []
    for i, (t, _) in enumerate(toks):
        tag = tags[i]
        low = t.lower()
        if low == "that":
            nxt = tags[i + 1] if i + 1 < len(tags) else "."
            prev = toks[i - 1][0].lower() if i > 0 else ""
            prev_tag = tags[i - 1] if i > 0 else None
            starts = i == 0 or prev_tag in (".", ":", "``")
            verbish = prev in VERBISH or prev.endswith(("es", "ed")) or prev_tag == "IN"
            tag = "DT" if (nxt is None and (verbish or starts)) else "IN"
        elif tag is None:
            tag = _content_pos(i, toks, tags)
        final.append(tag)
    return final


def _content_pos(i: int, toks: list[tuple[str, str]], tags: list[str | None]) -> str:
    """NN / VB guess for a content word, only used to pick noun/verb heteronym readings."""
    nxt = tags[i + 1] if i + 1 < len(tags) else None
    nxt_word = toks[i + 1][0].lower() if i + 1 < len(toks) else ""
    if nxt in ("DT", "PRP$") or (nxt == "PRP" and nxt_word in OBJ_PRONOUNS):
        return "VB"
    for j in range(i - 1, max(-1, i - 4), -1):
        tj = tags[j]
        if tj in (".", ",", ":", "CC"):
            break
        if tj in ("DT", "PRP$", "IN", "CD"):
            return "NN"
        if tj in ("TO", "MD", "PRP"):
            return "VB"
    return ""


# ---------------------------------------------------------------------------------
# G2P
# ---------------------------------------------------------------------------------
@dataclass
class Word:
    text: str
    phonemes: str
    source: str  # dictionary | lexicon-gold | lexicon-silver | espeak | punctuation | unknown


@dataclass
class G2POutput:
    caption: str
    audio_text: str
    phonemes: str
    words: list[Word]
    used_entries: list[dict]
    warnings: list[str] = field(default_factory=list)
    asr_alternatives: list[dict] = field(default_factory=list)


_SOURCE_BY_RATING = {5: "dictionary", 4: "lexicon-gold", 3: "lexicon-silver", 2: "espeak", 1: "espeak"}


class BritishG2P(misaki_en.G2P):
    """misaki's English G2P (British lexicon), without spaCy."""

    def __init__(self, dictionary: PronunciationDictionary | None = None):
        # Deliberately NOT calling misaki_en.G2P.__init__: it downloads and loads spaCy's
        # en_core_web_sm. The attributes it would set are reproduced here.
        self.version = None  # Kokoro v1.0 symbol set (flap -> T, glottal stop -> t)
        self.british = True
        self.lexicon = misaki_en.Lexicon(british=True)
        self.fallback = EspeakFallback(british=True)
        self.unk = ""
        self.dictionary = dictionary if dictionary is not None else PronunciationDictionary()
        self._slots: list[tuple[Entry, str]] = []

    # misaki calls self.tokenize(text, tokens, features)
    def tokenize(self, text, tokens, features):  # noqa: D401 - misaki API
        pairs = tokenize_words(text)
        tags = tag_tokens(pairs)
        result = []
        for (tok, ws), tag in zip(pairs, tags):
            mt = MToken(text=tok, tag=tag, whitespace=ws,
                        _=MToken.Underscore(is_head=True, num_flags="", prespace=False))
            m = SLOT_RE.fullmatch(tok)
            if m:
                e, sfx = self._slots[int(m.group(1))]
                ph = e.phonemes
                if isinstance(ph, dict):
                    parent = misaki_en.Lexicon.get_parent_tag(tag) or "DEFAULT"
                    ph = ph.get(tag, ph.get(parent, ph["DEFAULT"]))
                ph = self._inflect(ph, sfx)
                mt.text = e.key + sfx
                mt.phonemes = ph
                mt._.rating = 5
            result.append(mt)
        return result

    def _inflect(self, ph: str, sfx: str) -> str:
        if not sfx:
            return ph
        if sfx in ("s", "es", "'s", "’s", "s'", "s’"):
            return self.lexicon._s(ph)
        if sfx == "ed":
            return self.lexicon._ed(ph)
        if sfx == "ing":
            return self.lexicon._ing(ph) or ph + "ɹɪŋ"
        return ph

    def convert(self, caption: str) -> G2POutput:
        audio_text, used, slots = self.dictionary.apply(caption)
        audio_text = normalise_numbers(audio_text)
        audio_text = re.sub(r"\s+", " ", audio_text).strip()
        self._slots = slots
        phonemes, tokens = misaki_en.G2P.__call__(self, audio_text, preprocess=False)
        phonemes = re.sub(r"\s+", " ", phonemes).strip()
        words, warnings = [], []
        for tk in tokens:
            has_letters = any(c.isalpha() for c in tk.text)
            if not has_letters:
                src = "punctuation"
            elif not tk.phonemes:
                src = "unknown"
                warnings.append(f"no phonemes for {tk.text!r} (word would be silent)")
            else:
                # misaki stores a single word's rating on tk.rating, a merged word's on tk._.rating
                rating = getattr(tk, "rating", None) or tk._.rating
                src = _SOURCE_BY_RATING.get(rating, "lexicon-rule")
            if src == "espeak":
                warnings.append(f"espeak fallback: {tk.text} -> {tk.phonemes}")
            if (src not in ("dictionary", "punctuation") and len(tk.text) > 1
                    and tk.text.isupper() and tk.text.isalpha()):
                warnings.append(f"all-caps {tk.text!r} not in the dictionary (read as {tk.phonemes})")
            words.append(Word(tk.text, tk.phonemes or "", src))
        bad = sorted({c for c in phonemes if c not in GB_SYMBOLS})
        if bad:
            warnings.append(f"phoneme symbols outside the British set: {bad}")
        def show(m: re.Match) -> str:
            e, sfx = slots[int(m.group(1))]
            return f"[{e.key}{sfx}]"

        shown = SLOT_RE.sub(show, audio_text)
        alts = [{"key": e.key, "asr": list(e.asr)} for e in used if e.asr]
        return G2POutput(caption, shown, phonemes, words, [e.spec() for e in used], warnings, alts)


def fingerprint() -> dict:
    """Versions of everything that can change the phonemes."""
    from phonemizer.backend import EspeakBackend

    return {
        "g2p": G2P_VERSION,
        "misaki": md.version("misaki"),
        "phonemizer-fork": md.version("phonemizer-fork"),
        "espeakng-loader": md.version("espeakng-loader"),
        "espeak-ng": ".".join(map(str, EspeakBackend.version())),
        "num2words": md.version("num2words"),
    }
