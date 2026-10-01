/** The opening: the car in the studio and four ways in. */
import { useApp } from '../state/store';
import { PlayIcon } from './icons';

export function Intro() {
  const go = useApp((s) => s.go);
  const base = import.meta.env.BASE_URL;
  return (
    <>
      <section className="intro" aria-labelledby="intro-title" data-occludes="bottom">
        <div className="intro__head">
          <div className="intro__eyebrow">
            <img src={`${base}brand/kimble-mark-light.svg`} alt="" />
            <span>KIMBLE · A FAB / ONE simulation</span>
          </div>
          <h2 id="intro-title" className="intro__title">
            AUTOMOTIVE<span className="slash"> / </span>ONE
          </h2>
          <p className="intro__tag">How a car becomes motion: one modern car, every system, working.</p>
        </div>
        <div className="intro__cards">
          <button className="card card--primary pe" onClick={() => go({ mode: 'watch' })}>
            <b>
              <PlayIcon size={10} /> Watch
            </b>
            <span>How a car becomes motion · narrated film</span>
          </button>
          <button className="card pe" onClick={() => go({ mode: 'explore', system: null, part: null })}>
            <b>Explore</b>
            <span>Open it up, system by system, part by part</span>
          </button>
          <button className="card pe" onClick={() => go({ mode: 'engineer' })}>
            <b>Engineer</b>
            <span>Change gears, springs, tyres, brakes; see the effect</span>
          </button>
          <button className="card pe" onClick={() => go({ mode: 'simulate' })}>
            <b>Simulate</b>
            <span>Drive it yourself, or diagnose six real faults</span>
          </button>
        </div>
      </section>
      <p className="intro__meta">
        <b>S-1</b> · an original sedan designed for this simulation, not a product
        <br />
        2.5 L inline-four · 8-speed automatic · rear-wheel drive · 1,560 kg
      </p>
    </>
  );
}
