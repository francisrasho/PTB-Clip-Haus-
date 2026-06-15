import { useState, useEffect, useMemo } from "react";

/* Storage adapter: uses Claude's window.storage when running as a Claude
   artifact, and the browser's localStorage when deployed (Vercel etc).
   This means the same App.jsx file works in both places — paste future
   versions from Claude straight over this file. */
const store = {
  async get(key) {
    if (typeof window !== "undefined" && window.storage && window.storage.get) {
      return window.storage.get(key);
    }
    const v = localStorage.getItem(key);
    if (v == null) throw new Error("key not found");
    return { key, value: v };
  },
  async set(key, value) {
    if (typeof window !== "undefined" && window.storage && window.storage.set) {
      return window.storage.set(key, value);
    }
    localStorage.setItem(key, value);
    return { key, value };
  },
};


/* ─────────────────────────  CLIP HAUS — Premium Barber Booking v2  ───────────────────────── */

const SERVICES = [
  { id: "haircut", name: "Haircut", price: 40, display: "$40", desc: "Precision cut, styled to finish." },
  { id: "haircut-beard", name: "Haircut & Beard", price: 60, display: "$60", desc: "Full cut plus sculpted beard work." },
  { id: "kids", name: "Kids / School", price: 35, display: "$35", desc: "Sharp cuts for the young ones." },
  { id: "shave", name: "Hot Towel Shave", price: 30, display: "$30", desc: "Classic straight-razor ritual." },
  { id: "wax", name: "Wax", price: 10, display: "$5 – $10", desc: "Quick, clean detailing." },
  { id: "facial", name: "Facials", price: 25, display: "$25", desc: "Deep cleanse and refresh." },
  { id: "eyebrows", name: "Eyebrows", price: 5, display: "$5", desc: "Defined and tidy." },
  { id: "deluxe", name: "Deluxe Package", price: 100, display: "$100", desc: "The full Clip Haus experience.", featured: true },
];

/* services that can't be picked together (one includes the other) */
const MAIN_CUTS = ["haircut", "haircut-beard", "kids"];
const conflictsOf = (id) => {
  if (id === "deluxe") return SERVICES.map((s) => s.id).filter((x) => x !== "deluxe"); // deluxe includes everything
  if (MAIN_CUTS.includes(id)) return [...MAIN_CUTS.filter((x) => x !== id), "deluxe"];
  return ["deluxe"]; // add-ons clash only with the all-inclusive package
};

const DEFAULT_HOURS = {
  1: { open: "08:30", close: "19:30" },
  2: { open: "08:30", close: "14:30" },
  3: { open: "08:30", close: "19:30" },
  4: { open: "09:00", close: "22:30" },
  5: { open: "09:00", close: "21:30" },
  6: { open: "09:00", close: "21:30" },
  0: { open: "10:00", close: "18:30" },
};
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const STATUSES = ["Upcoming", "Confirmed", "Completed", "Cancelled", "No Show"];
const STATUS_COLOR = {
  Upcoming: "#22d3ee", Confirmed: "#a78bfa", Completed: "#4ade80", Cancelled: "#64748b", "No Show": "#fb7185",
};
const STORE_KEY = "cliphaus:data";
const ADMIN_PIN = "1234";
const SLOT_MIN = 30;

/* ── helpers ── */
const pad = (n) => String(n).padStart(2, "0");
const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => toDateStr(new Date());
const minsOf = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const timeOfMins = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const fmtTime = (t) => {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${ap}`;
};
const fmtDate = (ds) => {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const fmtDateShort = (ds) => {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const weekStart = (ds) => {
  const [y, m, d] = ds.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dt;
};

const EMPTY = { bookings: [], blockedDates: [], blockedSlots: [], hours: DEFAULT_HOURS, customerNotes: {}, enquiries: [], servicePrices: {} };

/* old single-service bookings → new multi-client shape */
const normalizeBooking = (b) =>
  b.clients ? b : {
    ...b,
    clients: [{ name: b.name, services: [b.serviceId].filter(Boolean), label: b.service || "", price: b.price || 0 }],
    total: b.price || 0,
  };

export default function ClipHaus() {
  const [data, setData] = useState(EMPTY);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState("home");
  const [fade, setFade] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await store.get(STORE_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setData({
            ...EMPTY, ...parsed,
            hours: { ...DEFAULT_HOURS, ...(parsed.hours || {}) },
            servicePrices: parsed.servicePrices || {},
            bookings: (parsed.bookings || []).map(normalizeBooking),
          });
        }
      } catch (e) { /* first run */ }
      setTimeout(() => setBooting(false), 1500);
    })();
  }, []);

  const save = (next) => {
    setData(next);
    try { store.set(STORE_KEY, JSON.stringify(next)); } catch (e) { console.error("save failed", e); }
  };

  /* services with admin price overrides applied */
  const services = useMemo(
    () => SERVICES.map((s) => {
      const ov = data.servicePrices[s.id] || {};
      const price = ov.price != null ? ov.price : s.price;
      const display = ov.display != null && ov.display !== "" ? ov.display : (ov.price != null ? `$${ov.price}` : s.display);
      return { ...s, price, display };
    }),
    [data.servicePrices]
  );

  const go = (v) => {
    if (v === view) return;
    setFade(true);
    setTimeout(() => { setView(v); setFade(false); window.scrollTo({ top: 0 }); }, 180);
  };

  /* every active booking occupies one 30-min slot per client */
  const occupiedSet = (dateStr, ignoreBookingId = null) => {
    const set = new Set();
    data.bookings.forEach((b) => {
      if (b.date !== dateStr || b.status === "Cancelled" || b.id === ignoreBookingId) return;
      const n = Math.max(1, (b.clients || []).length);
      const start = minsOf(b.time);
      for (let i = 0; i < n; i++) set.add(timeOfMins(start + i * SLOT_MIN));
    });
    data.blockedSlots.forEach((b) => { if (b.date === dateStr) set.add(b.time); });
    return set;
  };

  /* start times where `party` consecutive slots are free */
  const slotsFor = (dateStr, party = 1, ignoreBookingId = null) => {
    if (!dateStr) return [];
    if (data.blockedDates.some((b) => b.date === dateStr)) return [];
    const [y, m, d] = dateStr.split("-").map(Number);
    const hrs = data.hours[new Date(y, m - 1, d).getDay()];
    if (!hrs || !hrs.open || !hrs.close) return [];
    const open = minsOf(hrs.open), close = minsOf(hrs.close);
    const taken = occupiedSet(dateStr, ignoreBookingId);
    const now = new Date();
    const isToday = dateStr === todayStr();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const out = [];
    for (let t = open; t + party * SLOT_MIN <= close; t += SLOT_MIN) {
      if (isToday && t <= nowMins) continue;
      let free = true;
      for (let i = 0; i < party; i++) if (taken.has(timeOfMins(t + i * SLOT_MIN))) { free = false; break; }
      if (free) out.push(timeOfMins(t));
    }
    return out;
  };

  /* a date is bookable if it's open, not blocked, and not in the past */
  const dateDisabled = (ds) => {
    if (ds < todayStr()) return true;
    if (data.blockedDates.some((b) => b.date === ds)) return true;
    const [y, m, d] = ds.split("-").map(Number);
    const hrs = data.hours[new Date(y, m - 1, d).getDay()];
    return !hrs || !hrs.open || !hrs.close;
  };

  return (
    <div className="ch-root">
      <StyleSheet />
      {booting && <Splash />}
      <Nav view={view} go={go} />
      <main className={`ch-main ${fade ? "ch-fade-out" : "ch-fade-in"}`}>
        {view === "home" && <Home go={go} />}
        {view === "book" && <Booking data={data} save={save} slotsFor={slotsFor} dateDisabled={dateDisabled} services={services} go={go} />}
        {view === "prices" && <Prices services={services} go={go} />}
        {view === "hours" && <Hours data={data} />}
        {view === "contact" && <Contact data={data} save={save} />}
        {view === "admin" && <Admin data={data} save={save} slotsFor={slotsFor} dateDisabled={dateDisabled} services={services} />}
      </main>
      {view !== "book" && view !== "admin" && (
        <button className="ch-fab" onClick={() => go("book")}>Book Now ✂</button>
      )}
      <footer className="ch-footer">
        <Wordmark small />
        <p>0489 141 691 · @peterthebarber__</p>
        <button className="ch-admin-link" onClick={() => go("admin")}>Owner login</button>
      </footer>
    </div>
  );
}

/* ───────────────────────── branding ───────────────────────── */

function Wordmark({ small }) {
  return (
    <div className={`ch-logo ${small ? "ch-logo-sm" : ""}`}>
      <div className="ch-logo-frame"><span className="ch-logo-ptb">PTB</span></div>
      <span className="ch-logo-script">Clip Haus</span>
    </div>
  );
}

function Splash() {
  return (
    <div className="ch-splash">
      <div className="ch-splash-inner">
        <Wordmark />
        <div className="ch-splash-bar"><div className="ch-splash-fill" /></div>
      </div>
    </div>
  );
}

/* ───────────────────────── navigation ───────────────────────── */

function Nav({ view, go }) {
  const [open, setOpen] = useState(false);
  const links = [["home", "Home"], ["book", "Book"], ["prices", "Prices"], ["hours", "Hours"], ["contact", "Contact"]];
  return (
    <nav className="ch-nav">
      <button className="ch-nav-brand" onClick={() => { go("home"); setOpen(false); }}>
        <span className="ch-nav-ptb">PTB</span><span className="ch-nav-script">Clip Haus</span>
      </button>
      <div className="ch-nav-links">
        {links.map(([id, label]) => (
          <button key={id} className={`ch-nav-link ${view === id ? "active" : ""}`} onClick={() => go(id)}>{label}</button>
        ))}
      </div>
      <button className="ch-burger" onClick={() => setOpen(!open)} aria-label="Menu">{open ? "✕" : "☰"}</button>
      {open && (
        <div className="ch-mobile-menu">
          {links.map(([id, label]) => (
            <button key={id} className={`ch-nav-link ${view === id ? "active" : ""}`}
              onClick={() => { go(id); setOpen(false); }}>{label}</button>
          ))}
        </div>
      )}
    </nav>
  );
}

/* ───────────────────────── date picker ───────────────────────── */

function DatePicker({ value, onChange, isDisabled, placeholder = "Pick a date" }) {
  const [open, setOpen] = useState(false);
  const init = value || todayStr();
  const [vy, vm] = init.split("-").map(Number);
  const [month, setMonth] = useState({ y: vy, m: vm });
  const toggle = () => {
    if (!open && value) {
      const [y, m] = value.split("-").map(Number);
      setMonth({ y, m });
    }
    setOpen(!open);
  };
  const first = new Date(month.y, month.m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysIn = new Date(month.y, month.m, 0).getDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const label = first.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const nav = (n) => {
    const d = new Date(month.y, month.m - 1 + n, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() + 1 });
  };
  const thisMonth = new Date();
  const atCurrent = month.y === thisMonth.getFullYear() && month.m === thisMonth.getMonth() + 1;
  return (
    <div className="ch-dp-wrap">
      <button className={`ch-dp-trigger ${open ? "open" : ""} ${value ? "has-value" : ""}`} onClick={toggle}>
        <span className="ch-dp-cal-ico">📅</span>
        <span>{value ? fmtDate(value) : placeholder}</span>
        <i className="ch-dp-caret">{open ? "▴" : "▾"}</i>
      </button>
      {open && (
        <div className="ch-dp">
          <div className="ch-dp-head">
            <button className="ch-seg-btn" onClick={() => nav(-1)} disabled={atCurrent}>‹</button>
            <b>{label}</b>
            <button className="ch-seg-btn" onClick={() => nav(1)}>›</button>
          </div>
          <div className="ch-month-grid">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="ch-month-head">{d}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={i} />;
              const ds = `${month.y}-${pad(month.m)}-${pad(d)}`;
              const dis = isDisabled(ds);
              return (
                <button key={i} disabled={dis}
                  className={`ch-dp-cell ${ds === value ? "selected" : ""} ${ds === todayStr() ? "today" : ""}`}
                  onClick={() => { onChange(ds); setOpen(false); }}>{d}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── home ───────────────────────── */

function Home({ go }) {
  return (
    <section className="ch-hero">
      <div className="ch-hero-glow ch-glow-cyan" />
      <div className="ch-hero-glow ch-glow-pink" />
      <Wordmark />
      <h1 className="ch-h1">Premium Cuts.<br />Premium Experience.</h1>
      <p className="ch-sub">Book your next appointment in seconds.</p>
      <div className="ch-hero-cta">
        <button className="ch-btn ch-btn-primary" onClick={() => go("book")}>Book Now</button>
        <button className="ch-btn ch-btn-ghost" onClick={() => go("prices")}>View Prices</button>
      </div>
      <div className="ch-hero-cards">
        {[
          ["✂", "Master barbering", "Every cut finished to detail — fades, beards, hot towel shaves."],
          ["⚡", "Book in seconds", "Live availability. Bring the boys — book the whole crew at once."],
          ["◈", "Boutique experience", "One chair, full attention. No queues, no rush."],
        ].map(([icon, title, body]) => (
          <div key={title} className="ch-card ch-feature">
            <span className="ch-feature-icon">{icon}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── booking ───────────────────────── */

const clientLabel = (ids, services) =>
  ids.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean).join(" + ");
const clientPrice = (ids, services) =>
  ids.reduce((sum, id) => sum + (services.find((s) => s.id === id)?.price || 0), 0);

function ServicePicker({ selected, onToggle, services, compact }) {
  return (
    <div className={`ch-svc-grid ${compact ? "compact" : ""}`}>
      {services.map((s) => {
        const on = selected.includes(s.id);
        return (
          <button key={s.id} className={`ch-svc-pick ${on ? "selected" : ""}`} onClick={() => onToggle(s.id)}>
            <span>{on ? "✓ " : ""}{s.name}</span><b>{s.display}</b>
          </button>
        );
      })}
    </div>
  );
}

function Booking({ data, save, slotsFor, dateDisabled, services, go }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", date: "", time: "", notes: "" });
  const [clients, setClients] = useState([{ name: "", services: [] }]); // [0] = the person booking
  const [confirmed, setConfirmed] = useState(null);
  const [err, setErr] = useState("");

  const party = clients.length;
  const slots = useMemo(() => slotsFor(form.date, party), [form.date, party, data]);
  const total = clients.reduce((s, c) => s + clientPrice(c.services, services), 0);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === "date" ? { time: "" } : {}) }));

  const toggleService = (idx, id) => {
    setClients((cs) => cs.map((c, i) => {
      if (i !== idx) return c;
      if (c.services.includes(id)) return { ...c, services: c.services.filter((x) => x !== id) };
      const conflicts = conflictsOf(id);
      return { ...c, services: [...c.services.filter((x) => !conflicts.includes(x)), id] };
    }));
    setErr("");
  };

  const setParty = (n) => {
    setClients((cs) => {
      const next = cs.slice(0, n);
      while (next.length < n) next.push({ name: "", services: [] });
      return next;
    });
    setForm((f) => ({ ...f, time: "" })); // slot needs may change
  };

  const submit = () => {
    if (!form.name.trim() || !form.phone.trim()) { setErr("Please enter your name and phone number."); return; }
    if (clients.some((c) => c.services.length === 0)) { setErr("Pick at least one service for each person."); return; }
    if (clients.slice(1).some((c) => !c.name.trim())) { setErr("Please add a name for each extra person."); return; }
    if (!form.date || !form.time) { setErr("Choose a date and time."); return; }
    const snap = clients.map((c, i) => ({
      name: i === 0 ? form.name.trim() : c.name.trim(),
      services: c.services,
      label: clientLabel(c.services, services),
      price: clientPrice(c.services, services),
    }));
    const booking = {
      id: uid(), name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
      date: form.date, time: form.time, notes: form.notes.trim(), status: "Upcoming",
      clients: snap, total: snap.reduce((s, c) => s + c.price, 0), createdAt: new Date().toISOString(),
    };
    save({ ...data, bookings: [...data.bookings, booking] });
    setConfirmed(booking);
    window.scrollTo({ top: 0 });
  };

  if (confirmed) {
    const end = timeOfMins(minsOf(confirmed.time) + confirmed.clients.length * SLOT_MIN);
    return (
      <section className="ch-page ch-narrow">
        <div className="ch-card ch-confirm">
          <div className="ch-confirm-tick">✓</div>
          <h2 className="ch-h2">You're booked in</h2>
          <p className="ch-sub" style={{ margin: "4px 0 20px" }}>We'll see you at the Haus.</p>
          <div className="ch-confirm-rows">
            <Row k="When" v={`${fmtDate(confirmed.date)}`} />
            <Row k="Time" v={`${fmtTime(confirmed.time)} – ${fmtTime(end)}`} />
            {confirmed.clients.map((c, i) => (
              <Row key={i} k={c.name || `Person ${i + 1}`} v={`${c.label} — $${c.price}`} />
            ))}
            <Row k="Total" v={`$${confirmed.total}`} />
          </div>
          <p className="ch-fineprint">Need to change it? Call 0489 141 691.</p>
          <div className="ch-hero-cta">
            <button className="ch-btn ch-btn-primary" onClick={() => {
              setConfirmed(null);
              setForm({ name: "", phone: "", email: "", date: "", time: "", notes: "" });
              setClients([{ name: "", services: [] }]);
            }}>Book another</button>
            <button className="ch-btn ch-btn-ghost" onClick={() => go("home")}>Back to home</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ch-page ch-narrow">
      <h2 className="ch-h2">Book an appointment</h2>
      <p className="ch-sub" style={{ marginBottom: 24 }}>Live availability — taken slots are hidden automatically.</p>
      <div className="ch-card ch-form">
        <label className="ch-label">Your name *
          <input className="ch-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" />
        </label>
        <div className="ch-grid2">
          <label className="ch-label">Phone *
            <input className="ch-input" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="04xx xxx xxx" />
          </label>
          <label className="ch-label">Email (optional)
            <input className="ch-input" inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.com" />
          </label>
        </div>

        <span className="ch-label">How many people? *</span>
        <div className="ch-seg">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={`ch-seg-btn ${party === n ? "active" : ""}`} onClick={() => setParty(n)}>{n}</button>
          ))}
        </div>
        {party > 1 && <p className="ch-hint">Back-to-back chairs — your group takes {party} slots in a row ({party * SLOT_MIN} min).</p>}

        <span className="ch-label">Your services * <em className="ch-hint-inline">pick as many as you like</em></span>
        <ServicePicker selected={clients[0].services} onToggle={(id) => toggleService(0, id)} services={services} />
        {clients[0].services.length > 0 && (
          <p className="ch-running">You: {clientLabel(clients[0].services, services)} — <b className="ch-cyan">${clientPrice(clients[0].services, services)}</b></p>
        )}

        {clients.slice(1).map((c, i) => (
          <div key={i} className="ch-extra">
            <div className="ch-extra-head">
              <b>Person {i + 2}</b>
              <button className="ch-chip ch-chip-dim" onClick={() => setParty(party - 1)}>Remove</button>
            </div>
            <input className="ch-input" placeholder={`Person ${i + 2}'s name *`} value={c.name}
              onChange={(e) => setClients((cs) => cs.map((x, j) => (j === i + 1 ? { ...x, name: e.target.value } : x)))} />
            <ServicePicker compact selected={c.services} onToggle={(id) => toggleService(i + 1, id)} services={services} />
            {c.services.length > 0 && (
              <p className="ch-running">{c.name || `Person ${i + 2}`}: {clientLabel(c.services, services)} — <b className="ch-cyan">${clientPrice(c.services, services)}</b></p>
            )}
          </div>
        ))}

        <span className="ch-label">Pick a date *</span>
        <DatePicker value={form.date} onChange={(ds) => set("date", ds)} isDisabled={dateDisabled} />

        {form.date && (
          <>
            <span className="ch-label">Available times for {fmtDateShort(form.date)} *</span>
            {slots.length === 0 ? (
              <p className="ch-empty">No times left for {party > 1 ? `a group of ${party}` : "this day"} — try another date.</p>
            ) : (
              <div className="ch-slot-grid">
                {slots.map((s) => (
                  <button key={s} className={`ch-slot ${form.time === s ? "selected" : ""}`} onClick={() => set("time", s)}>{fmtTime(s)}</button>
                ))}
              </div>
            )}
          </>
        )}

        <label className="ch-label">Notes (optional)
          <textarea className="ch-input" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything Peter should know?" />
        </label>
        {err && <p className="ch-error">{err}</p>}
        <button className="ch-btn ch-btn-primary ch-btn-full" onClick={submit}>
          Confirm booking{total > 0 ? ` — $${total}` : ""}
        </button>
      </div>
    </section>
  );
}

/* ───────────────────────── prices ───────────────────────── */

function Prices({ services, go }) {
  return (
    <section className="ch-page">
      <h2 className="ch-h2">Price list</h2>
      <p className="ch-sub" style={{ marginBottom: 28 }}>Straightforward pricing. No surprises.</p>
      <div className="ch-price-grid">
        {services.map((s) => (
          <div key={s.id} className={`ch-card ch-price-card ${s.featured ? "featured" : ""}`}>
            {s.featured && <span className="ch-badge">Most popular</span>}
            <h3>{s.name}</h3>
            <p className="ch-price-desc">{s.desc}</p>
            <div className="ch-price-row">
              <span className="ch-price">{s.display}</span>
              <button className="ch-btn ch-btn-mini" onClick={() => go("book")}>Book</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── hours ───────────────────────── */

function Hours({ data }) {
  const todayDow = new Date().getDay();
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <section className="ch-page ch-narrow">
      <h2 className="ch-h2">Opening hours</h2>
      <p className="ch-sub" style={{ marginBottom: 24 }}>Walk-ins by luck. Bookings by choice.</p>
      <div className="ch-card">
        {order.map((d) => {
          const h = data.hours[d];
          return (
            <div key={d} className={`ch-hours-row ${d === todayDow ? "today" : ""}`}>
              <span>{DAY_NAMES[d]}{d === todayDow && <em className="ch-today-dot"> · today</em>}</span>
              <b>{h && h.open ? `${fmtTime(h.open)} – ${fmtTime(h.close)}` : "Closed"}</b>
            </div>
          );
        })}
      </div>
      <div className="ch-card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Surcharges</h3>
        <div className="ch-hours-row"><span>Early Bird</span><b className="ch-cyan">+$10</b></div>
        <div className="ch-hours-row"><span>After Hours</span><b className="ch-pink">+$15</b></div>
        <div className="ch-hours-row"><span>Public Holiday</span><b className="ch-pink">+$15</b></div>
      </div>
    </section>
  );
}

/* ───────────────────────── contact ───────────────────────── */

function Contact({ data, save }) {
  const [f, setF] = useState({ name: "", phone: "", message: "" });
  const [sent, setSent] = useState(false);
  const send = () => {
    if (!f.name.trim() || !f.message.trim()) return;
    save({ ...data, enquiries: [...(data.enquiries || []), { ...f, id: uid(), at: new Date().toISOString() }] });
    setSent(true);
  };
  return (
    <section className="ch-page ch-narrow">
      <h2 className="ch-h2">Get in touch</h2>
      <p className="ch-sub" style={{ marginBottom: 24 }}>Questions, group bookings, or just say hey.</p>
      <div className="ch-contact-grid">
        <a className="ch-card ch-contact-card" href="tel:0489141691">
          <span className="ch-contact-icon">📞</span><b>Call or text</b><p>0489 141 691</p>
        </a>
        <a className="ch-card ch-contact-card" href="https://instagram.com/peterthebarber__" target="_blank" rel="noreferrer">
          <span className="ch-contact-icon">◉</span><b>Instagram</b><p>@peterthebarber__</p>
        </a>
        <a className="ch-card ch-contact-card" href="https://tiktok.com/@peterthebarber__" target="_blank" rel="noreferrer">
          <span className="ch-contact-icon">♪</span><b>TikTok</b><p>@peterthebarber__</p>
        </a>
      </div>
      <div className="ch-card ch-form" style={{ marginTop: 20 }}>
        {sent ? (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div className="ch-confirm-tick" style={{ margin: "0 auto 12px" }}>✓</div>
            <h3>Message sent</h3>
            <p className="ch-sub">Peter will get back to you soon.</p>
          </div>
        ) : (
          <>
            <h3 style={{ marginBottom: 8 }}>Send an enquiry</h3>
            <div className="ch-grid2">
              <label className="ch-label">Name
                <input className="ch-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </label>
              <label className="ch-label">Phone
                <input className="ch-input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              </label>
            </div>
            <label className="ch-label">Message
              <textarea className="ch-input" rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
            </label>
            <button className="ch-btn ch-btn-primary ch-btn-full" onClick={send}>Send enquiry</button>
          </>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── admin ───────────────────────── */

function Admin({ data, save, slotsFor, dateDisabled, services }) {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState(false);
  const [tab, setTab] = useState("overview");

  if (!authed) {
    return (
      <section className="ch-page ch-narrow">
        <div className="ch-card ch-form" style={{ maxWidth: 380, margin: "40px auto", textAlign: "center" }}>
          <h2 className="ch-h2" style={{ fontSize: 28 }}>Owner login</h2>
          <p className="ch-sub" style={{ marginBottom: 16 }}>Enter your PIN to manage bookings.</p>
          <input className={`ch-input ch-pin ${pinErr ? "shake" : ""}`} type="password" inputMode="numeric"
            value={pin} placeholder="••••" maxLength={8}
            onChange={(e) => { setPin(e.target.value); setPinErr(false); }}
            onKeyDown={(e) => e.key === "Enter" && (pin === ADMIN_PIN ? setAuthed(true) : setPinErr(true))} />
          {pinErr && <p className="ch-error">Wrong PIN — try again.</p>}
          <button className="ch-btn ch-btn-primary ch-btn-full" style={{ marginTop: 12 }}
            onClick={() => (pin === ADMIN_PIN ? setAuthed(true) : setPinErr(true))}>Unlock</button>
        </div>
      </section>
    );
  }

  const tabs = [["overview", "Overview"], ["schedule", "Schedule"], ["bookings", "Bookings"], ["customers", "Customers"], ["pricing", "Pricing"], ["availability", "Availability"]];
  return (
    <section className="ch-page">
      <div className="ch-admin-head">
        <h2 className="ch-h2">Dashboard</h2>
        <button className="ch-btn ch-btn-ghost ch-btn-mini" onClick={() => setAuthed(false)}>Log out</button>
      </div>
      <div className="ch-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={`ch-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "overview" && <Overview data={data} />}
      {tab === "schedule" && <Schedule data={data} />}
      {tab === "bookings" && <Bookings data={data} save={save} slotsFor={slotsFor} dateDisabled={dateDisabled} />}
      {tab === "customers" && <Customers data={data} save={save} />}
      {tab === "pricing" && <Pricing data={data} save={save} services={services} />}
      {tab === "availability" && <Availability data={data} save={save} dateDisabled={dateDisabled} />}
    </section>
  );
}

/* one compact line describing a booking's people + services */
function PartySummary({ b }) {
  const n = b.clients.length;
  return (
    <span className="ch-dim">
      {b.clients.map((c) => `${c.name || "—"} (${c.label})`).join(" · ")}{" "}
      {n > 1 && <i className="ch-party-tag">{n} people</i>}
    </span>
  );
}

function Overview({ data }) {
  const today = todayStr();
  const live = data.bookings.filter((b) => b.status !== "Cancelled");
  const todays = live.filter((b) => b.date === today);
  const upcoming = live.filter((b) => b.date >= today && ["Upcoming", "Confirmed"].includes(b.status));
  const completed = data.bookings.filter((b) => b.status === "Completed");
  const ws = weekStart(today); const we = new Date(ws); we.setDate(we.getDate() + 6);
  const weekCount = live.filter((b) => b.date >= toDateStr(ws) && b.date <= toDateStr(we)).length;
  const enq = (data.enquiries || []).slice(-3).reverse();

  return (
    <div>
      <div className="ch-stat-grid">
        <Stat label="Today's bookings" value={todays.length} accent="#22d3ee" />
        <Stat label="Upcoming" value={upcoming.length} accent="#a78bfa" />
        <Stat label="Completed (all time)" value={completed.length} accent="#4ade80" />
        <Stat label="This week" value={weekCount} accent="#f472b6" />
      </div>
      <div className="ch-card" style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 12 }}>Today — {fmtDate(today)}</h3>
        {todays.length === 0 ? <p className="ch-empty">No bookings today yet. Time for a coffee.</p> :
          todays.sort((a, b) => a.time.localeCompare(b.time)).map((b) => (
            <div key={b.id} className="ch-booking-row">
              <b className="ch-cyan">{fmtTime(b.time)}</b>
              <span>{b.name}</span>
              <PartySummary b={b} />
              <b className="ch-pink">${b.total}</b>
              <StatusPill s={b.status} />
            </div>
          ))}
      </div>
      {enq.length > 0 && (
        <div className="ch-card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Latest enquiries</h3>
          {enq.map((e) => (
            <div key={e.id} className="ch-enquiry">
              <b>{e.name}</b>{e.phone && <span className="ch-dim"> · {e.phone}</span>}
              <p>{e.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="ch-card ch-stat" style={{ "--accent": accent }}>
      <span className="ch-stat-num">{value}</span>
      <span className="ch-stat-label">{label}</span>
    </div>
  );
}

function StatusPill({ s }) {
  return <span className="ch-pill" style={{ color: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] + "55" }}>{s}</span>;
}

/* schedule */
function Schedule({ data }) {
  const [mode, setMode] = useState("day");
  const [anchor, setAnchor] = useState(todayStr());
  const live = data.bookings.filter((b) => b.status !== "Cancelled");

  const shift = (n) => {
    const [y, m, d] = anchor.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    if (mode === "day") dt.setDate(dt.getDate() + n);
    if (mode === "week") dt.setDate(dt.getDate() + n * 7);
    if (mode === "month") dt.setMonth(dt.getMonth() + n);
    setAnchor(toDateStr(dt));
  };

  return (
    <div>
      <div className="ch-sched-bar">
        <div className="ch-seg">
          {["day", "week", "month"].map((m) => (
            <button key={m} className={`ch-seg-btn ${mode === m ? "active" : ""}`} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
        <div className="ch-seg">
          <button className="ch-seg-btn" onClick={() => shift(-1)}>‹</button>
          <button className="ch-seg-btn" onClick={() => setAnchor(todayStr())}>Today</button>
          <button className="ch-seg-btn" onClick={() => shift(1)}>›</button>
        </div>
      </div>
      {mode === "day" && <DaySched date={anchor} bookings={live} data={data} />}
      {mode === "week" && <WeekSched anchor={anchor} bookings={live} data={data} />}
      {mode === "month" && <MonthSched anchor={anchor} bookings={live} setAnchor={setAnchor} setMode={setMode} />}
    </div>
  );
}

function DaySched({ date, bookings, data }) {
  const day = bookings.filter((b) => b.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const blocked = data.blockedDates.find((b) => b.date === date);
  return (
    <div className="ch-card">
      <h3 style={{ marginBottom: 12 }}>{fmtDate(date)} {blocked && <span className="ch-pill" style={{ color: "#fb7185", borderColor: "#fb718555", marginLeft: 8 }}>Blocked{blocked.label ? ` · ${blocked.label}` : ""}</span>}</h3>
      {day.length === 0 ? <p className="ch-empty">Nothing booked this day.</p> :
        day.map((b) => {
          const end = timeOfMins(minsOf(b.time) + b.clients.length * SLOT_MIN);
          return (
            <div key={b.id} className="ch-booking-row">
              <b className="ch-cyan">{fmtTime(b.time)}–{fmtTime(end)}</b>
              <span>{b.name}</span>
              <PartySummary b={b} />
              <StatusPill s={b.status} />
            </div>
          );
        })}
    </div>
  );
}

function WeekSched({ anchor, bookings, data }) {
  const start = weekStart(anchor);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return toDateStr(d); });
  return (
    <div className="ch-week">
      {days.map((ds) => {
        const list = bookings.filter((b) => b.date === ds).sort((a, b) => a.time.localeCompare(b.time));
        const blocked = data.blockedDates.some((b) => b.date === ds);
        return (
          <div key={ds} className={`ch-card ch-week-day ${ds === todayStr() ? "today" : ""}`}>
            <b>{fmtDate(ds).replace(/, \d{4}$/, "")}</b>
            {blocked && <span className="ch-dim" style={{ color: "#fb7185" }}>Blocked</span>}
            {list.length === 0 && !blocked ? <span className="ch-dim">—</span> :
              list.map((b) => (
                <span key={b.id} className="ch-week-item">
                  <i className="ch-cyan">{fmtTime(b.time)}</i> {b.name}{b.clients.length > 1 ? ` +${b.clients.length - 1}` : ""}
                </span>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function MonthSched({ anchor, bookings, setAnchor, setMode }) {
  const [y, m] = anchor.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, m, 0).getDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const monthName = first.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  return (
    <div className="ch-card">
      <h3 style={{ marginBottom: 12 }}>{monthName}</h3>
      <div className="ch-month-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="ch-month-head">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const ds = `${y}-${pad(m)}-${pad(d)}`;
          const n = bookings.filter((b) => b.date === ds).length;
          return (
            <button key={i} className={`ch-month-cell ${ds === todayStr() ? "today" : ""} ${n ? "has" : ""}`}
              onClick={() => { setAnchor(ds); setMode("day"); }}>
              <span>{d}</span>{n > 0 && <i>{n}</i>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* bookings management */
function Bookings({ data, save, slotsFor, dateDisabled }) {
  const [filter, setFilter] = useState("All");
  const [resched, setResched] = useState(null);
  const [rd, setRd] = useState({ date: "", time: "" });

  const setStatus = (id, status) =>
    save({ ...data, bookings: data.bookings.map((b) => (b.id === id ? { ...b, status } : b)) });

  const doResched = () => {
    if (!rd.date || !rd.time) return;
    save({ ...data, bookings: data.bookings.map((b) => (b.id === resched.id ? { ...b, date: rd.date, time: rd.time, status: "Upcoming" } : b)) });
    setResched(null); setRd({ date: "", time: "" });
  };

  const list = data.bookings
    .filter((b) => filter === "All" || b.status === filter)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const reschedSlots = resched ? slotsFor(rd.date, resched.clients.length, resched.id) : [];

  return (
    <div>
      <div className="ch-seg" style={{ flexWrap: "wrap", marginBottom: 14 }}>
        {["All", ...STATUSES].map((s) => (
          <button key={s} className={`ch-seg-btn ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>
      {list.length === 0 ? <div className="ch-card"><p className="ch-empty">No bookings here yet.</p></div> :
        list.map((b) => (
          <div key={b.id} className="ch-card ch-manage" style={{ marginBottom: 10 }}>
            <div className="ch-manage-top">
              <div>
                <b>{b.name}</b> <span className="ch-dim">· {b.phone}</span>
                {b.clients.length > 1 && <i className="ch-party-tag" style={{ marginLeft: 6 }}>{b.clients.length} people</i>}
                <p className="ch-dim" style={{ margin: "2px 0 0" }}>{fmtDate(b.date)} · {fmtTime(b.time)} — <b className="ch-pink">${b.total}</b></p>
                <div className="ch-client-list">
                  {b.clients.map((c, i) => (
                    <span key={i} className="ch-client-line">• {c.name || `Person ${i + 1}`} — {c.label} <em>(${c.price})</em></span>
                  ))}
                </div>
                {b.notes && <p className="ch-note">"{b.notes}"</p>}
              </div>
              <StatusPill s={b.status} />
            </div>
            <div className="ch-manage-actions">
              {b.status !== "Confirmed" && b.status !== "Completed" && <button className="ch-chip" onClick={() => setStatus(b.id, "Confirmed")}>Confirm</button>}
              {b.status !== "Completed" && <button className="ch-chip ch-chip-green" onClick={() => setStatus(b.id, "Completed")}>Complete</button>}
              <button className="ch-chip" onClick={() => { setResched(b); setRd({ date: b.date, time: "" }); }}>Reschedule</button>
              {b.status !== "No Show" && <button className="ch-chip ch-chip-pink" onClick={() => setStatus(b.id, "No Show")}>No show</button>}
              {b.status !== "Cancelled" && <button className="ch-chip ch-chip-dim" onClick={() => setStatus(b.id, "Cancelled")}>Cancel</button>}
            </div>
          </div>
        ))}
      {resched && (
        <div className="ch-modal-bg" onClick={() => setResched(null)}>
          <div className="ch-card ch-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Reschedule {resched.name}{resched.clients.length > 1 ? ` (${resched.clients.length} people)` : ""}</h3>
            <span className="ch-label">New date</span>
            <DatePicker value={rd.date} onChange={(ds) => setRd({ date: ds, time: "" })} isDisabled={dateDisabled} />
            {rd.date && (reschedSlots.length === 0 ? <p className="ch-empty">No free times that day.</p> : (
              <div className="ch-slot-grid">
                {reschedSlots.map((s) => (
                  <button key={s} className={`ch-slot ${rd.time === s ? "selected" : ""}`} onClick={() => setRd({ ...rd, time: s })}>{fmtTime(s)}</button>
                ))}
              </div>
            ))}
            <div className="ch-hero-cta" style={{ marginTop: 14 }}>
              <button className="ch-btn ch-btn-primary" onClick={doResched} disabled={!rd.time}>Save new time</button>
              <button className="ch-btn ch-btn-ghost" onClick={() => setResched(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* customers */
function Customers({ data, save }) {
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState("");

  const customers = useMemo(() => {
    const map = {};
    data.bookings.forEach((b) => {
      const key = b.phone || b.name;
      if (!map[key]) map[key] = { key, name: b.name, phone: b.phone, visits: [] };
      map[key].visits.push(b);
    });
    return Object.values(map).sort((a, b) => b.visits.length - a.visits.length);
  }, [data.bookings]);

  const saveNote = (key) => save({ ...data, customerNotes: { ...data.customerNotes, [key]: note } });

  if (open) {
    const c = customers.find((x) => x.key === open);
    if (!c) return null;
    const done = c.visits.filter((v) => v.status === "Completed");
    const spent = done.reduce((s, v) => s + (v.total || 0), 0);
    return (
      <div>
        <button className="ch-chip" onClick={() => setOpen(null)}>‹ All customers</button>
        <div className="ch-card" style={{ marginTop: 12 }}>
          <h3>{c.name}</h3>
          <p className="ch-dim">{c.phone}</p>
          <div className="ch-stat-grid" style={{ marginTop: 14 }}>
            <Stat label="Visits" value={c.visits.length} accent="#22d3ee" />
            <Stat label="Completed" value={done.length} accent="#4ade80" />
            <Stat label="Total spent" value={`$${spent}`} accent="#f472b6" />
          </div>
          <h4 style={{ margin: "18px 0 8px" }}>History</h4>
          {c.visits.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).map((v) => (
            <div key={v.id} className="ch-booking-row">
              <b className="ch-cyan">{fmtDateShort(v.date)}</b>
              <span className="ch-dim" style={{ flex: 1 }}>{v.clients.map((cl) => cl.label).join(" · ")}{v.clients.length > 1 ? ` (${v.clients.length} people)` : ""}</span>
              <span className="ch-dim">${v.total}</span>
              <StatusPill s={v.status} />
            </div>
          ))}
          <h4 style={{ margin: "18px 0 8px" }}>Notes</h4>
          <textarea className="ch-input" rows={3} defaultValue={data.customerNotes[c.key] || ""}
            onChange={(e) => setNote(e.target.value)} placeholder="Fade preference, clipper guard, conversation topics…" />
          <button className="ch-btn ch-btn-primary ch-btn-mini" style={{ marginTop: 10 }} onClick={() => saveNote(c.key)}>Save note</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {customers.length === 0 ? <div className="ch-card"><p className="ch-empty">Customers appear here after their first booking.</p></div> :
        customers.map((c) => {
          const spent = c.visits.filter((v) => v.status === "Completed").reduce((s, v) => s + (v.total || 0), 0);
          return (
            <button key={c.key} className="ch-card ch-cust-row" onClick={() => { setOpen(c.key); setNote(data.customerNotes[c.key] || ""); }}>
              <div><b>{c.name}</b><p className="ch-dim">{c.phone}</p></div>
              <div className="ch-cust-meta"><span>{c.visits.length} visit{c.visits.length !== 1 ? "s" : ""}</span><b className="ch-cyan">${spent}</b></div>
            </button>
          );
        })}
    </div>
  );
}

/* pricing */
function Pricing({ data, save, services }) {
  const update = (id, field, val) =>
    save({
      ...data,
      servicePrices: {
        ...data.servicePrices,
        [id]: { ...(data.servicePrices[id] || {}), [field]: field === "price" ? (val === "" ? null : Number(val)) : val },
      },
    });
  const reset = (id) => {
    const next = { ...data.servicePrices };
    delete next[id];
    save({ ...data, servicePrices: next });
  };
  return (
    <div className="ch-card">
      <h3>Edit pricing</h3>
      <p className="ch-dim" style={{ marginBottom: 14 }}>
        Price is what's charged and totalled. Label is what customers see (handy for ranges like "$5 – $10"). Changes apply everywhere instantly.
      </p>
      <div className="ch-price-edit-head">
        <span>Service</span><span>Price ($)</span><span>Label shown</span><span />
      </div>
      {services.map((s) => {
        const edited = !!data.servicePrices[s.id];
        return (
          <div key={s.id} className="ch-price-edit-row">
            <b>{s.name}{edited && <i className="ch-edited-dot" title="Edited">●</i>}</b>
            <input className="ch-input" type="number" min="0" inputMode="numeric" value={s.price}
              onChange={(e) => update(s.id, "price", e.target.value)} />
            <input className="ch-input" value={s.display} placeholder={`$${s.price}`}
              onChange={(e) => update(s.id, "display", e.target.value)} />
            <button className="ch-chip ch-chip-dim" onClick={() => reset(s.id)} disabled={!edited}>Reset</button>
          </div>
        );
      })}
      <p className="ch-fineprint" style={{ marginBottom: 0 }}>Past bookings keep the price they were booked at — only new bookings use updated prices.</p>
    </div>
  );
}

/* availability */
function Availability({ data, save, dateDisabled }) {
  const [bd, setBd] = useState({ date: "", label: "" });
  const [bs, setBs] = useState({ date: "", time: "" });
  const order = [1, 2, 3, 4, 5, 6, 0];

  const addBlockedDate = () => {
    if (!bd.date) return;
    save({ ...data, blockedDates: [...data.blockedDates.filter((b) => b.date !== bd.date), { ...bd }] });
    setBd({ date: "", label: "" });
  };
  const addBlockedSlot = () => {
    if (!bs.date || !bs.time) return;
    save({ ...data, blockedSlots: [...data.blockedSlots, { ...bs }] });
    setBs({ date: "", time: "" });
  };
  const setHours = (d, field, val) =>
    save({ ...data, hours: { ...data.hours, [d]: { ...data.hours[d], [field]: val } } });

  return (
    <div className="ch-avail">
      <div className="ch-card">
        <h3>Holidays & blocked dates</h3>
        <p className="ch-dim" style={{ marginBottom: 12 }}>Customers can't book these days at all. Tap a date, add a label, block it.</p>
        <DatePicker value={bd.date} onChange={(ds) => setBd({ ...bd, date: ds })} isDisabled={(ds) => ds < todayStr()} />
        <input className="ch-input" style={{ marginTop: 10 }} placeholder="Label (e.g. Public holiday)" value={bd.label} onChange={(e) => setBd({ ...bd, label: e.target.value })} />
        <button className="ch-btn ch-btn-primary ch-btn-mini" style={{ marginTop: 10 }} onClick={addBlockedDate} disabled={!bd.date}>
          Block {bd.date ? fmtDateShort(bd.date) : "date"}
        </button>
        <div style={{ marginTop: 12 }}>
          {data.blockedDates.sort((a, b) => a.date.localeCompare(b.date)).map((b) => (
            <div key={b.date} className="ch-booking-row">
              <b className="ch-pink">{fmtDate(b.date)}</b>
              <span className="ch-dim">{b.label || "Blocked"}</span>
              <button className="ch-chip ch-chip-dim" onClick={() => save({ ...data, blockedDates: data.blockedDates.filter((x) => x.date !== b.date) })}>Remove</button>
            </div>
          ))}
        </div>
      </div>

      <div className="ch-card">
        <h3>Block a single time slot</h3>
        <p className="ch-dim" style={{ marginBottom: 12 }}>Hide one time on one day — e.g. an appointment of your own.</p>
        <DatePicker value={bs.date} onChange={(ds) => setBs({ ...bs, date: ds })} isDisabled={dateDisabled} />
        <input className="ch-input" style={{ marginTop: 10 }} type="time" step={1800} value={bs.time} onChange={(e) => setBs({ ...bs, time: e.target.value })} />
        <button className="ch-btn ch-btn-primary ch-btn-mini" style={{ marginTop: 10 }} onClick={addBlockedSlot} disabled={!bs.date || !bs.time}>Block slot</button>
        <div style={{ marginTop: 12 }}>
          {data.blockedSlots.map((b, i) => (
            <div key={i} className="ch-booking-row">
              <b className="ch-pink">{fmtDateShort(b.date)} · {fmtTime(b.time)}</b>
              <button className="ch-chip ch-chip-dim" onClick={() => save({ ...data, blockedSlots: data.blockedSlots.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
        </div>
      </div>

      <div className="ch-card">
        <h3>Working hours</h3>
        <p className="ch-dim" style={{ marginBottom: 12 }}>Booking slots are generated from these hours.</p>
        {order.map((d) => (
          <div key={d} className="ch-hours-edit">
            <span>{DAY_NAMES[d]}</span>
            <input className="ch-input" type="time" value={data.hours[d]?.open || ""} onChange={(e) => setHours(d, "open", e.target.value)} />
            <span className="ch-dim">to</span>
            <input className="ch-input" type="time" value={data.hours[d]?.close || ""} onChange={(e) => setHours(d, "close", e.target.value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return <div className="ch-confirm-row"><span>{k}</span><b>{v}</b></div>;
}

/* ───────────────────────── styles ───────────────────────── */

function StyleSheet() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap');

.ch-root {
  --bg: #08080b; --panel: rgba(255,255,255,0.04); --line: rgba(255,255,255,0.09);
  --text: #f5f6f8; --dim: #9aa1ad; --cyan: #29e0ff; --pink: #ff4dd8; --purple:#a78bfa;
  min-height: 100vh; background: var(--bg); color: var(--text);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  position: relative; overflow-x: hidden;
}
.ch-root::before {
  content:''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(700px 400px at 85% -10%, rgba(41,224,255,0.08), transparent 60%),
    radial-gradient(700px 420px at 10% 110%, rgba(255,77,216,0.07), transparent 60%);
  animation: ch-ambient 14s ease-in-out infinite alternate;
}
@keyframes ch-ambient { from { opacity:.7 } to { opacity:1 } }
* { box-sizing: border-box; margin: 0; }
button { font-family: inherit; cursor: pointer; }
input, textarea { font-family: inherit; }

/* splash */
.ch-splash { position: fixed; inset:0; z-index: 100; background: var(--bg); display:flex; align-items:center; justify-content:center; animation: ch-splash-out .5s ease 1.3s forwards; }
@keyframes ch-splash-out { to { opacity:0; visibility:hidden } }
.ch-splash-inner { text-align:center; animation: ch-pop .7s cubic-bezier(.2,.9,.3,1.2); }
@keyframes ch-pop { from { transform: scale(.85); opacity:0 } }
.ch-splash-bar { width: 160px; height: 3px; border-radius: 3px; background: rgba(255,255,255,.08); margin: 26px auto 0; overflow:hidden; }
.ch-splash-fill { height:100%; width:40%; border-radius:3px; background: linear-gradient(90deg, var(--cyan), var(--pink)); animation: ch-load 1.3s ease forwards; }
@keyframes ch-load { from { width: 5% } to { width: 100% } }

/* logo */
.ch-logo { display:flex; flex-direction:column; align-items:center; position:relative; z-index:1; }
.ch-logo-frame { position: relative; padding: 6px 30px 2px; }
.ch-logo-frame::before, .ch-logo-frame::after { content:''; position:absolute; inset:0; border-radius: 4px; }
.ch-logo-frame::before { border: 2px solid var(--cyan); transform: translate(-5px,-5px); box-shadow: 0 0 18px rgba(41,224,255,.5); }
.ch-logo-frame::after { border: 2px solid var(--pink); transform: translate(5px,5px); box-shadow: 0 0 18px rgba(255,77,216,.45); }
.ch-logo-ptb { font-family: 'Bebas Neue', 'Arial Narrow', sans-serif; font-size: 88px; line-height: .95; letter-spacing: 6px; color: #fff; text-shadow: 0 0 30px rgba(255,255,255,.35); }
.ch-logo-script { font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 30px; color: var(--pink); text-shadow: 0 0 14px rgba(255,77,216,.8); margin-top: 2px; transform: rotate(-4deg); }
.ch-logo-sm .ch-logo-ptb { font-size: 40px; letter-spacing:3px; }
.ch-logo-sm .ch-logo-frame { padding: 3px 16px 0; }
.ch-logo-sm .ch-logo-frame::before { transform: translate(-3px,-3px); }
.ch-logo-sm .ch-logo-frame::after { transform: translate(3px,3px); }
.ch-logo-sm .ch-logo-script { font-size: 18px; }

/* nav */
.ch-nav { position: sticky; top:0; z-index: 50; display:flex; align-items:center; justify-content:space-between;
  padding: 12px 20px; background: rgba(8,8,11,.72); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--line); }
.ch-nav-brand { background:none; border:none; display:flex; align-items:baseline; gap:8px; }
.ch-nav-ptb { font-family:'Bebas Neue', sans-serif; font-size:26px; letter-spacing:3px; color:#fff; }
.ch-nav-script { font-family:'Brush Script MT','Segoe Script',cursive; color: var(--pink); font-size:17px; text-shadow:0 0 10px rgba(255,77,216,.7); }
.ch-nav-links { display:flex; gap:4px; }
.ch-nav-link { background:none; border:none; color: var(--dim); font-size:14px; font-weight:500; padding:8px 14px; border-radius: 99px; transition: all .25s; }
.ch-nav-link:hover { color:#fff; }
.ch-nav-link.active { color:#fff; background: rgba(41,224,255,.1); box-shadow: inset 0 0 0 1px rgba(41,224,255,.3); }
.ch-burger { display:none; background:none; border:none; color:#fff; font-size:22px; }
.ch-mobile-menu { position:absolute; top:100%; left:0; right:0; background: rgba(10,10,14,.97); backdrop-filter: blur(20px); border-bottom:1px solid var(--line); display:flex; flex-direction:column; padding:10px; animation: ch-drop .25s ease; }
@keyframes ch-drop { from { opacity:0; transform: translateY(-8px) } }
.ch-mobile-menu .ch-nav-link { text-align:left; padding:14px 16px; font-size:16px; }

/* layout */
.ch-main { position:relative; z-index:1; max-width: 1060px; margin: 0 auto; padding: 0 20px 100px; transition: opacity .18s ease, transform .18s ease; }
.ch-fade-out { opacity:0; transform: translateY(8px); }
.ch-fade-in { opacity:1; transform: none; }
.ch-page { padding-top: 44px; animation: ch-rise .45s ease; }
@keyframes ch-rise { from { opacity:0; transform: translateY(14px) } }
.ch-narrow { max-width: 640px; margin: 0 auto; }

/* hero */
.ch-hero { padding: 70px 0 30px; text-align:center; position:relative; }
.ch-hero-glow { position:absolute; width: 420px; height: 420px; border-radius:50%; filter: blur(110px); opacity:.16; pointer-events:none; }
.ch-glow-cyan { background: var(--cyan); top:-120px; right:-80px; animation: ch-drift 11s ease-in-out infinite alternate; }
.ch-glow-pink { background: var(--pink); bottom:-160px; left:-100px; animation: ch-drift 13s ease-in-out infinite alternate-reverse; }
@keyframes ch-drift { to { transform: translate(30px,20px) scale(1.08) } }
.ch-h1 { font-family:'Bebas Neue', sans-serif; font-size: clamp(46px, 8vw, 76px); letter-spacing: 3px; line-height: 1.02; margin: 34px 0 12px; }
.ch-h2 { font-family:'Bebas Neue', sans-serif; font-size: clamp(32px, 5vw, 44px); letter-spacing: 2px; }
.ch-sub { color: var(--dim); font-size: 17px; }
.ch-hero-cta { display:flex; gap: 12px; justify-content:center; margin-top: 28px; flex-wrap:wrap; }

.ch-btn { border:none; border-radius: 14px; padding: 15px 30px; font-size: 15px; font-weight: 600; transition: all .25s; }
.ch-btn-primary { background: linear-gradient(120deg, var(--cyan), #4d9eff 55%, var(--pink)); color: #06070a; box-shadow: 0 6px 26px rgba(41,224,255,.35); }
.ch-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 34px rgba(255,77,216,.4); }
.ch-btn-primary:disabled { opacity:.45; transform:none; cursor: not-allowed; }
.ch-btn-ghost { background: rgba(255,255,255,.05); color:#fff; box-shadow: inset 0 0 0 1px var(--line); }
.ch-btn-ghost:hover { box-shadow: inset 0 0 0 1px rgba(41,224,255,.5); }
.ch-btn-full { width:100%; margin-top: 16px; }
.ch-btn-mini { padding: 9px 16px; font-size: 13px; border-radius: 10px; }

/* cards */
.ch-card { background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 22px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); transition: border-color .3s, transform .3s, box-shadow .3s; }
.ch-hero-cards { display:grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 60px; text-align:left; }
.ch-feature:hover { transform: translateY(-4px); border-color: rgba(41,224,255,.35); box-shadow: 0 14px 40px rgba(0,0,0,.45); }
.ch-feature-icon { font-size: 22px; color: var(--cyan); text-shadow: 0 0 16px rgba(41,224,255,.7); }
.ch-feature h3 { margin: 12px 0 6px; font-size: 17px; }
.ch-feature p { color: var(--dim); font-size: 14px; line-height: 1.55; }

/* forms */
.ch-form { display:flex; flex-direction:column; gap: 14px; }
.ch-label { display:flex; flex-direction:column; gap:6px; font-size: 13px; font-weight:600; color: var(--dim); letter-spacing:.3px; }
.ch-hint { color: var(--dim); font-size: 12.5px; }
.ch-hint-inline { font-style: normal; font-weight: 400; color: var(--dim); opacity:.8; }
.ch-running { font-size: 13.5px; color: var(--text); }
.ch-input { background: rgba(0,0,0,.35); border: 1px solid var(--line); color:#fff; border-radius: 12px; padding: 13px 14px; font-size: 15px; outline:none; transition: all .2s; width:100%; }
.ch-input:focus { border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(41,224,255,.15); }
.ch-grid2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ch-svc-grid { display:grid; grid-template-columns: repeat(2,1fr); gap: 10px; }
.ch-svc-grid.compact { gap: 7px; }
.ch-svc-grid.compact .ch-svc-pick { padding: 10px 12px; font-size: 13px; }
.ch-svc-pick { display:flex; justify-content:space-between; align-items:center; gap:8px; background: rgba(0,0,0,.3); border:1px solid var(--line); border-radius:12px; padding: 13px 14px; color: var(--dim); font-size:14px; transition: all .2s; text-align:left; }
.ch-svc-pick b { color:#fff; white-space:nowrap; }
.ch-svc-pick:hover { border-color: rgba(255,255,255,.25); }
.ch-svc-pick.selected { border-color: var(--cyan); color:#fff; background: rgba(41,224,255,.08); box-shadow: 0 0 18px rgba(41,224,255,.18); }
.ch-extra { border: 1px dashed var(--line); border-radius: 16px; padding: 14px; display:flex; flex-direction:column; gap: 10px; }
.ch-extra-head { display:flex; justify-content:space-between; align-items:center; font-size: 14px; }
.ch-slot-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(92px,1fr)); gap: 8px; }
.ch-slot { background: rgba(0,0,0,.3); border:1px solid var(--line); border-radius: 10px; padding: 11px 4px; color: var(--dim); font-size: 13px; font-weight:600; transition: all .2s; }
.ch-slot:hover { color:#fff; border-color: rgba(255,255,255,.3); }
.ch-slot.selected { border-color: var(--pink); color:#fff; background: rgba(255,77,216,.1); box-shadow: 0 0 16px rgba(255,77,216,.25); }
.ch-error { color: #fb7185; font-size: 14px; }
.ch-empty { color: var(--dim); font-size: 14px; padding: 8px 0; }
.ch-fineprint { color: var(--dim); font-size: 13px; margin: 14px 0; }

/* date picker */
.ch-dp-wrap { display:flex; flex-direction:column; gap: 8px; }
.ch-dp-trigger { display:flex; align-items:center; gap: 10px; width:100%; text-align:left; background: rgba(0,0,0,.35); border: 1px solid var(--line); color: var(--dim); border-radius: 12px; padding: 13px 14px; font-size: 15px; font-weight: 500; transition: all .2s; }
.ch-dp-trigger:hover { border-color: rgba(255,255,255,.3); }
.ch-dp-trigger.open { border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(41,224,255,.15); }
.ch-dp-trigger.has-value { color: #fff; }
.ch-dp-caret { margin-left:auto; font-style: normal; color: var(--dim); font-size: 12px; }
.ch-dp-cal-ico { font-size: 15px; }
.ch-dp { background: rgba(0,0,0,.3); border: 1px solid var(--line); border-radius: 16px; padding: 14px; animation: ch-drop .2s ease; }
.ch-dp-head { display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; font-size: 15px; }
.ch-dp-cell { aspect-ratio: 1; background: transparent; border: 1px solid transparent; border-radius: 10px; color: #dbe0e8; font-size: 14px; font-weight: 600; transition: all .15s; }
.ch-dp-cell:hover:not(:disabled) { border-color: rgba(255,255,255,.3); }
.ch-dp-cell:disabled { color: rgba(255,255,255,.18); cursor: not-allowed; }
.ch-dp-cell.today { border-color: rgba(41,224,255,.4); color: var(--cyan); }
.ch-dp-cell.selected { background: linear-gradient(120deg, var(--cyan), var(--pink)); color: #06070a; box-shadow: 0 0 18px rgba(41,224,255,.35); }

/* confirmation */
.ch-confirm { text-align:center; }
.ch-confirm-tick { width: 58px; height:58px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin: 6px auto 16px; font-size: 26px; color:#06070a; background: linear-gradient(135deg, var(--cyan), #4ade80); box-shadow: 0 0 30px rgba(74,222,128,.4); animation: ch-pop .5s cubic-bezier(.2,.9,.3,1.4); }
.ch-confirm-rows { text-align:left; margin: 8px 0; }
.ch-confirm-row { display:flex; justify-content:space-between; gap: 14px; padding: 11px 0; border-bottom: 1px solid var(--line); font-size: 15px; }
.ch-confirm-row span { color: var(--dim); }
.ch-confirm-row b { text-align:right; }

/* prices */
.ch-price-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(240px,1fr)); gap: 14px; }
.ch-price-card { position:relative; overflow:hidden; }
.ch-price-card:hover { transform: translateY(-4px); border-color: rgba(255,77,216,.4); }
.ch-price-card.featured { border-color: rgba(255,77,216,.45); box-shadow: 0 0 30px rgba(255,77,216,.12); }
.ch-badge { position:absolute; top: 14px; right: 14px; font-size: 11px; font-weight:700; letter-spacing:.5px; color: var(--pink); border:1px solid rgba(255,77,216,.5); padding: 4px 10px; border-radius: 99px; }
.ch-price-card h3 { font-size: 18px; margin-bottom: 6px; }
.ch-price-desc { color: var(--dim); font-size: 13.5px; min-height: 38px; }
.ch-price-row { display:flex; justify-content:space-between; align-items:center; margin-top: 14px; }
.ch-price { font-family:'Bebas Neue', sans-serif; font-size: 30px; letter-spacing: 1px; color: var(--cyan); text-shadow: 0 0 14px rgba(41,224,255,.5); }

/* hours */
.ch-hours-row { display:flex; justify-content:space-between; align-items:center; padding: 13px 4px; border-bottom: 1px solid var(--line); font-size: 15px; }
.ch-hours-row:last-child { border-bottom:none; }
.ch-hours-row span { color: var(--dim); }
.ch-hours-row.today span, .ch-hours-row.today b { color: var(--cyan); }
.ch-today-dot { font-style: normal; font-size: 12px; }
.ch-cyan { color: var(--cyan); } .ch-pink { color: var(--pink); }

/* contact */
.ch-contact-grid { display:grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
.ch-contact-card { text-decoration:none; color:#fff; text-align:center; display:flex; flex-direction:column; gap: 4px; align-items:center; }
.ch-contact-card:hover { transform: translateY(-3px); border-color: rgba(41,224,255,.4); }
.ch-contact-card p { color: var(--dim); font-size: 13.5px; }
.ch-contact-icon { font-size: 22px; }

/* admin */
.ch-admin-head { display:flex; justify-content:space-between; align-items:center; }
.ch-tabs { display:flex; gap: 6px; margin: 18px 0 20px; overflow-x:auto; padding-bottom: 4px; }
.ch-tab { background: rgba(255,255,255,.04); border: 1px solid var(--line); color: var(--dim); padding: 10px 16px; border-radius: 99px; font-size: 13.5px; font-weight:600; white-space:nowrap; transition: all .2s; }
.ch-tab.active { color:#06070a; background: linear-gradient(120deg, var(--cyan), var(--pink)); border-color: transparent; box-shadow: 0 4px 18px rgba(41,224,255,.3); }
.ch-pin { text-align:center; font-size: 22px; letter-spacing: 8px; }
.shake { animation: ch-shake .3s; border-color:#fb7185 !important; }
@keyframes ch-shake { 25% { transform: translateX(-5px) } 75% { transform: translateX(5px) } }
.ch-stat-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); gap: 12px; }
.ch-stat { display:flex; flex-direction:column; gap: 4px; border-top: 2px solid var(--accent); }
.ch-stat-num { font-family:'Bebas Neue', sans-serif; font-size: 36px; color: var(--accent); text-shadow: 0 0 16px color-mix(in srgb, var(--accent) 50%, transparent); }
.ch-stat-label { color: var(--dim); font-size: 12.5px; font-weight: 600; letter-spacing:.3px; }
.ch-booking-row { display:flex; align-items:center; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--line); font-size: 14.5px; flex-wrap:wrap; }
.ch-booking-row:last-child { border-bottom:none; }
.ch-booking-row > span:nth-child(2) { font-weight: 600; }
.ch-booking-row .ch-pill { margin-left:auto; }
.ch-dim { color: var(--dim); }
.ch-pill { font-size: 11.5px; font-weight: 700; letter-spacing:.4px; border:1px solid; padding: 4px 10px; border-radius: 99px; }
.ch-party-tag { font-style: normal; font-size: 11px; font-weight: 800; color: #06070a; background: linear-gradient(120deg, var(--cyan), var(--pink)); border-radius: 99px; padding: 2px 8px; }
.ch-client-list { display:flex; flex-direction:column; gap: 2px; margin-top: 6px; }
.ch-client-line { font-size: 13.5px; color: #cfd4dc; }
.ch-client-line em { font-style: normal; color: var(--dim); }
.ch-enquiry { padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
.ch-enquiry:last-child { border-bottom: none; }
.ch-enquiry p { color: var(--dim); margin-top: 3px; }

/* pricing editor */
.ch-price-edit-head { display:grid; grid-template-columns: 1.3fr .8fr 1fr auto; gap: 10px; font-size: 12px; font-weight: 700; color: var(--dim); letter-spacing:.4px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.ch-price-edit-row { display:grid; grid-template-columns: 1.3fr .8fr 1fr auto; gap: 10px; align-items:center; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
.ch-price-edit-row:last-of-type { border-bottom: none; }
.ch-price-edit-row .ch-input { padding: 9px 11px; font-size: 14px; }
.ch-edited-dot { font-style: normal; color: var(--cyan); font-size: 9px; margin-left: 6px; vertical-align: middle; }
.ch-chip:disabled { opacity:.35; cursor: not-allowed; }

/* schedule */
.ch-sched-bar { display:flex; justify-content:space-between; gap: 10px; margin-bottom: 14px; flex-wrap:wrap; }
.ch-seg { display:flex; gap: 6px; flex-wrap: wrap; }
.ch-seg-btn { background: rgba(255,255,255,.04); border:1px solid var(--line); color: var(--dim); padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight:600; transition: all .2s; }
.ch-seg-btn.active { color:#fff; border-color: var(--cyan); background: rgba(41,224,255,.1); }
.ch-seg-btn:disabled { opacity:.3; cursor: not-allowed; }
.ch-week { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap: 10px; }
.ch-week-day { display:flex; flex-direction:column; gap: 7px; padding: 14px; font-size: 13px; }
.ch-week-day.today { border-color: rgba(41,224,255,.5); }
.ch-week-item i { font-style: normal; font-weight: 700; }
.ch-month-grid { display:grid; grid-template-columns: repeat(7,1fr); gap: 6px; }
.ch-month-head { text-align:center; color: var(--dim); font-size: 12px; font-weight:700; padding: 4px 0; }
.ch-month-cell { aspect-ratio: 1; background: rgba(0,0,0,.25); border: 1px solid var(--line); border-radius: 10px; color: var(--dim); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; font-size: 13px; transition: all .2s; }
.ch-month-cell:hover { border-color: rgba(255,255,255,.3); color:#fff; }
.ch-month-cell.today { border-color: var(--cyan); color: var(--cyan); }
.ch-month-cell.has { color: #fff; }
.ch-month-cell i { font-style:normal; font-size: 10.5px; font-weight:800; color:#06070a; background: linear-gradient(120deg, var(--cyan), var(--pink)); border-radius: 99px; padding: 1px 6px; }

/* bookings management */
.ch-manage-top { display:flex; justify-content:space-between; gap: 10px; align-items:flex-start; }
.ch-manage-actions { display:flex; gap: 8px; margin-top: 14px; flex-wrap:wrap; }
.ch-chip { background: rgba(255,255,255,.05); border: 1px solid var(--line); color: #dbe0e8; font-size: 12.5px; font-weight:600; padding: 7px 13px; border-radius: 99px; transition: all .2s; }
.ch-chip:hover { border-color: rgba(255,255,255,.35); }
.ch-chip-green { color:#4ade80; border-color: rgba(74,222,128,.35); }
.ch-chip-pink { color:#fb7185; border-color: rgba(251,113,133,.35); }
.ch-chip-dim { color: var(--dim); }
.ch-note { color: var(--purple); font-size: 13px; margin-top: 4px; }
.ch-modal-bg { position: fixed; inset:0; z-index: 80; background: rgba(0,0,0,.7); backdrop-filter: blur(6px); display:flex; align-items:center; justify-content:center; padding: 20px; animation: ch-fade .2s; }
@keyframes ch-fade { from { opacity:0 } }
.ch-modal { width: 100%; max-width: 460px; max-height: 85vh; overflow-y:auto; display:flex; flex-direction:column; gap: 12px; }

/* customers */
.ch-cust-row { width:100%; display:flex; justify-content:space-between; align-items:center; gap: 10px; margin-bottom: 10px; text-align:left; color:#fff; }
.ch-cust-row:hover { border-color: rgba(41,224,255,.4); transform: translateX(3px); }
.ch-cust-meta { text-align:right; display:flex; flex-direction:column; gap:2px; font-size: 13px; color: var(--dim); }

/* availability */
.ch-avail { display:flex; flex-direction:column; gap: 16px; }
.ch-hours-edit { display:grid; grid-template-columns: 92px 1fr auto 1fr; align-items:center; gap: 8px; padding: 7px 0; font-size: 14px; }

/* fab + footer */
.ch-fab { position: fixed; bottom: 22px; right: 22px; z-index: 60; border:none; border-radius: 99px; padding: 16px 26px; font-size: 15px; font-weight: 700; color: #06070a; background: linear-gradient(120deg, var(--cyan), var(--pink)); box-shadow: 0 8px 30px rgba(255,77,216,.45); animation: ch-pulse 2.6s ease-in-out infinite; transition: transform .2s; }
.ch-fab:hover { transform: scale(1.06); }
@keyframes ch-pulse { 0%,100% { box-shadow: 0 8px 30px rgba(255,77,216,.45) } 50% { box-shadow: 0 8px 38px rgba(41,224,255,.55) } }
.ch-footer { position:relative; z-index:1; text-align:center; padding: 50px 20px 90px; border-top: 1px solid var(--line); color: var(--dim); font-size: 13.5px; display:flex; flex-direction:column; gap: 12px; align-items:center; }
.ch-admin-link { background:none; border:none; color: var(--dim); font-size: 12px; text-decoration: underline; opacity:.7; }
.ch-admin-link:hover { color: var(--cyan); opacity:1; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
@media (max-width: 760px) {
  .ch-nav-links { display:none; }
  .ch-burger { display:block; }
  .ch-hero-cards, .ch-contact-grid { grid-template-columns: 1fr; }
  .ch-grid2, .ch-svc-grid { grid-template-columns: 1fr; }
  .ch-logo-ptb { font-size: 64px; }
  .ch-hours-edit { grid-template-columns: 80px 1fr auto 1fr; }
  .ch-price-edit-head { display:none; }
  .ch-price-edit-row { grid-template-columns: 1fr 1fr; }
  .ch-price-edit-row b { grid-column: 1 / -1; }
}
`}</style>
  );
}
