// The field manual: one long page you scroll through to learn the game. Sections animate in as they
// appear, the illustrations replay on click, and the search box filters and highlights everything.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import { audio } from "../../app/audio.ts";
import type { Sfx } from "../../app/audio.ts";
import { RACES, raceDef } from "../../engine/content.ts";
import { portraitUrl } from "../common.tsx";
import { GROUPS, SECTIONS, plain, search, terms } from "./content.ts";
import type { Item, Section } from "./content.ts";
import { Illustration } from "./illustrations.tsx";
import "./manual.css";

const EXTRA_PORTRAITS = ["brokers", "fine-print", "superposed", "unwritten"];

// Scrolling fast past many sections should not fire a burst of sounds.
let lastSfx = 0;
function sfx(name: Sfx, force = false): void {
  const now = performance.now();
  if (!force && now - lastSfx < 900) return;
  lastSfx = now;
  audio.sfx(name);
}

/** Renders **bold** and highlights search words with <mark>. */
function Rich({ text, words }: { text: string; words: string[] }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p) => {
        const bold = p.startsWith("**") && p.endsWith("**");
        const body = <Marked text={bold ? p.slice(2, -2) : p} words={words} />;
        return bold ? <b>{body}</b> : body;
      })}
    </>
  );
}

function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${esc.join("|")})`, "gi");
  const parts = text.split(re);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <mark>{p}</mark> : p))}</>;
}

/** Calls back once when the element first scrolls into view, and reports visibility for the TOC. */
function useInView(root: { current: HTMLElement | null }, onEnter: (id: string) => void) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { setSeen(true); onEnter(el.id); }
    }, { root: root.current, threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, seen };
}

function SectionView({ s, items, words, root, onEnter, sound }: {
  s: Section; items?: Item[]; words: string[]; root: { current: HTMLElement | null }; onEnter: (id: string) => void; sound: boolean;
}) {
  const { ref, seen } = useInView(root, onEnter);
  const [run, setRun] = useState(0);
  const played = useRef(false);
  useEffect(() => {
    if (seen && !played.current) {
      played.current = true;
      if (sound && s.sfx) sfx(s.sfx);
    }
  }, [seen]);
  const replay = () => { setRun((r) => r + 1); if (sound && s.sfx) sfx(s.sfx, true); };
  const race = s.race ? raceDef(s.race) : null;
  const style = race ? ({ "--hue": race.hue } as JSX.CSSProperties) : undefined;
  return (
    <section id={s.id} ref={ref as any} class={`m-section ${seen ? "in" : ""} ${s.art ? "has-art" : ""} ${race ? "is-race" : ""}`} style={style}>
      <div class="m-text">
        {s.kicker && <div class="m-kicker"><Marked text={s.kicker} words={words} /></div>}
        <h2><Marked text={s.title} words={words} /></h2>
        {s.paras.map((p) => <p><Rich text={p} words={words} /></p>)}
        {items && items.length > 0 && (
          <div class={`m-items ${s.id === "glossary" ? "glossary" : ""}`}>
            {items.map((it, k) => (
              <div class={`m-item ${it.img ? "with-img" : ""}`} style={{ transitionDelay: `${Math.min(k, 12) * 40}ms` }}>
                {it.img && <img src={`./assets/img/races/${it.img}.webp`} alt="" class="m-item-img" />}
                {it.icon && <span class="m-item-icon">{it.icon}</span>}
                <div>
                  <b><Marked text={it.title} words={words} /></b>{it.tag && <span class="chip m-tag">{it.tag}</span>}
                  <div class="m-item-text"><Marked text={it.text} words={words} /></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {s.art && (
        <button class="m-art" onClick={replay} title="Click to replay" aria-label={`Replay the ${s.title} animation`}>
          <Illustration key={run} art={s.art} race={s.race} play={seen} />
          <span class="m-replay">↻ replay</span>
        </button>
      )}
    </section>
  );
}

function Hero({ onStart }: { onStart: () => void }) {
  const portraits = [...RACES.map((r) => portraitUrl(r.id)), ...EXTRA_PORTRAITS.map((p) => `./assets/img/races/${p}.webp`)];
  return (
    <header class="m-hero">
      <div class="m-hero-bg" style={{ backgroundImage: "url(./assets/img/title.webp)" }} />
      <div class="m-hero-in">
        <div class="m-hero-kicker">Field manual</div>
        <div class="logo">EXCEPTION</div>
        <p class="m-hero-tag">Every alien race is a patch to the rulebook. Scroll down to learn the game in a few minutes, or search for anything.</p>
        <button class="btn primary" onClick={onStart}>Start reading ↓</button>
      </div>
      <div class="m-marquee" aria-hidden="true">
        <div class="m-marquee-track">
          {[...portraits, ...portraits].map((src) => <img src={src} alt="" />)}
        </div>
      </div>
    </header>
  );
}

function Group({ name, children }: { name: string; children: ComponentChildren }) {
  return (
    <div class="m-group" id={`group-${name.replace(/\s+/g, "-").toLowerCase()}`}>
      <div class="m-group-head"><span>{name}</span></div>
      {children}
    </div>
  );
}

const noop = () => {};

export function Manual({ onExit, start }: { onExit: () => void; start?: string }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<string>("");
  const [sound, setSound] = useState(!audio.muted);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => search(q), [q]);
  const words = useMemo(() => terms(q), [q]);
  const searching = words.length > 0;

  useEffect(() => { audio.music("council"); }, []);

  // Deep link (?manual=races) and the "/" shortcut.
  useEffect(() => {
    if (start) {
      const el = document.getElementById(start) ?? document.getElementById(`group-${start}`) ?? document.getElementById(`race-${start}`);
      el?.scrollIntoView();
    }
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement === input.current;
      if (e.key === "/" && !typing) { e.preventDefault(); input.current?.focus(); input.current?.select(); }
      if (e.key === "Escape") { if (q) setQ(""); else if (!typing) onExit(); input.current?.blur(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q]);

  // Parallax for the hero image.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      el.style.setProperty("--scroll", String(el.scrollTop));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // The current section is the last one whose top has passed the upper third of the screen.
        let id = "";
        for (const sec of el.querySelectorAll<HTMLElement>(".m-section")) {
          if (sec.getBoundingClientRect().top <= window.innerHeight * 0.35) id = sec.id;
          else break;
        }
        setActive(id);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, []);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && matches.length) {
      const best = [...matches].sort((a, b) => b.score - a.score)[0];
      jump(best.section.id);
    }
  };
  const toggleSound = () => { const on = !sound; setSound(on); audio.setMuted(!on); };

  const byGroup = GROUPS.map((g) => ({ g, ms: matches.filter((m) => m.section.group === g) })).filter((x) => x.ms.length);

  return (
    <div class={`manual ${searching ? "searching" : ""}`} ref={scroller}>
      <div class="m-bg" style={{ backgroundImage: "url(./assets/img/galaxy-bg.webp)" }} />
      <div class="m-bar-top">
        <button class="btn small" onClick={onExit}>← Menu</button>
        <div class="m-search">
          <span class="m-search-icon">⌕</span>
          <input
            ref={input} type="search" placeholder="Search the manual" value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={onSearchKey as any}
            aria-label="Search the manual"
          />
          {searching && <span class="m-count">{matches.length ? `${matches.length} section${matches.length > 1 ? "s" : ""}` : "no match"}</span>}
        </div>
        <button class={`btn small ${sound ? "" : "on"}`} onClick={toggleSound} title="Sound">{sound ? "♪ on" : "♪ off"}</button>
      </div>

      <div class="m-layout">
        <nav class="m-toc" aria-label="Contents">
          {byGroup.map(({ g, ms }) => (
            <div class="m-toc-group">
              <div class="m-toc-head">{g}</div>
              {ms.map(({ section: s }) => (
                <a href={`#${s.id}`} class={active === s.id ? "on" : ""} onClick={(e) => { e.preventDefault(); jump(s.id); }}>
                  {s.race && <img src={portraitUrl(s.race)} alt="" />}{plain(s.title)}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <main class="m-main">
          {!searching && <Hero onStart={() => jump(SECTIONS[0].id)} />}
          {searching && !matches.length && (
            <div class="m-empty">
              Nothing found for “{q}”. Try a word like <button class="linkish" onClick={() => setQ("raise")}>raise</button>,{" "}
              <button class="linkish" onClick={() => setQ("sway")}>sway</button> or a race name.
            </div>
          )}
          {byGroup.map(({ g, ms }) => (
            <Group name={g}>
              {g === "Races" && !searching && (
                <div class="m-race-strip">
                  {RACES.map((r) => (
                    <button class="m-race-chip" onClick={() => jump(`race-${r.id}`)} style={{ "--hue": r.hue } as JSX.CSSProperties}>
                      <img src={portraitUrl(r.id)} alt="" /><span>{r.short}</span>
                    </button>
                  ))}
                </div>
              )}
              {ms.map((m) => (
                <SectionView key={m.section.id} s={m.section} items={m.items} words={words} root={scroller} onEnter={noop} sound={sound} />
              ))}
            </Group>
          ))}
          {!searching && (
            <footer class="m-foot">
              <div class="logo" style={{ fontSize: 28 }}>EXCEPTION</div>
              <p class="muted">Ready? The tutorial game shows all of this in motion.</p>
              <button class="btn primary" onClick={onExit}>Back to the menu</button>
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}
