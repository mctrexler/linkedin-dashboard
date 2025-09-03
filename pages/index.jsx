import React from "react";
import Papa from "papaparse";

// -------------------- Helpers --------------------
// Extract a single-column list from a CSV (case-insensitive, flexible headers)
function extractCSVList(rows, candidates) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const first = rows.find(r => r && Object.keys(r).length) || {};
    const keyMap = Object.keys(first).reduce((acc, k) => { acc[k.toLowerCase()] = k; return acc; }, {});
    let chosen = null;
    for (const c of candidates) { if (keyMap[c]) { chosen = keyMap[c]; break; } }
    if (!chosen) { chosen = Object.keys(first)[0] || null; }
    if (!chosen) return [];
    const out = rows.map(r => String((r && r[chosen]) || '').trim()).filter(Boolean);
    return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
}

function parseDateSafe(v) {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [y, m, d] = v.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        return isNaN(dt.getTime()) ? null : dt;
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function formatDateShort(v) {
    // Accept either a Date or a string
    const d = v instanceof Date ? v : parseDateSafe(v);
    if (!d) return v || "";
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${yyyy}-${mm}-${dd}`;
}


function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function tryFetchCSV(path) {
    try {
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) return null;
        const text = await res.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        return parsed.data || null;
    } catch {
        return null;
    }
}


// Treat blank as include=true; only explicit no values exclude
function truthyInclude(v) {
    const s = String(v || "").trim().toLowerCase();
    if (!s) return true;
    return ["y", "yes", "1", "true"].includes(s);
}

// Relative 'X time ago' parser for LinkedIn and a unified date parser (no regex backrefs)
function parseRelativeLinkedInDate(v, now = new Date()) {
    if (!v) return null;
    let s = String(v).toLowerCase().trim();
    // normalize punctuation to spaces
    const junk = ['·', '•', '–', '—', '.'];
    for (const ch of junk) s = s.split(ch).join(' ');
    // collapse multiple spaces
    while (s.indexOf('  ') !== -1) s = s.replace('  ', ' ');
    // insert a space between trailing number and unit, e.g., "2h" -> "2 h"
    function numUnitSpacing(str) {
        let out = '';
        function isDigit(c) { return c >= '0' && c <= '9'; }
        function isLetter(c) { return c >= 'a' && c <= 'z'; }
        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            const p = i > 0 ? str[i - 1] : '';
            if (i > 0 && isDigit(p) && isLetter(c) && p !== ' ') out += ' ';
            out += c;
        }
        return out;
    }
    s = numUnitSpacing(s);

    if (s === 'just now') return new Date(now);
    if (s === 'yesterday') { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 1); return d; }

    const parts = s.split(' ');
    if (!parts.length) return null;
    // handle optional prefixes like "about", "approx", "approximately"
    let idx = 0;
    if (['about', 'approx', 'approximately'].includes(parts[idx])) idx++;
    if (idx >= parts.length) return null;
    const n = parseInt(parts[idx++], 10);
    if (!isFinite(n)) return null;
    if (idx >= parts.length) return null;
    let unit = parts[idx++];
    // optional trailing 'ago'
    if (idx < parts.length && parts[idx] === 'ago') idx++;

    // normalize units
    const map = {
        min: ['min', 'mins', 'minute', 'minutes', 'm'],
        hr: ['hr', 'hrs', 'hour', 'hours', 'h'],
        day: ['day', 'days', 'd'],
        week: ['week', 'weeks', 'wk', 'wks', 'w'],
        month: ['month', 'months', 'mo', 'mos'],
        year: ['yr', 'yrs', 'year', 'years', 'y']
    };
    let kind = null;
    for (const k in map) { if (map[k].includes(unit)) { kind = k; break; } }
    if (!kind) return null;

    const d = new Date(now);
    switch (kind) {
        case 'min': d.setUTCMinutes(d.getUTCMinutes() - n); break;
        case 'hr': d.setUTCHours(d.getUTCHours() - n); break;
        case 'day': d.setUTCDate(d.getUTCDate() - n); break;
        case 'week': d.setUTCDate(d.getUTCDate() - n * 7); break;
        case 'month': d.setUTCMonth(d.getUTCMonth() - n); break;
        case 'year': d.setUTCFullYear(d.getUTCFullYear() - n); break;
    }
    return d;
}
function parseAnyDate(v) { const abs = parseDateSafe(v); if (abs) return abs; return parseRelativeLinkedInDate(v); }

// ============================================================
// Default export — LinkedIn Posts Dashboard (standalone)
// ============================================================
export default function LinkedInPostsPage() {
    return <LinkedInPostsDashboard />;
}

function LinkedInPostsDashboard() {
    const [rows, setRows] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState("");

    // Filters / controls
    const [authors, setAuthors] = React.useState([]);
    const [tags, setTags] = React.useState([]);
    const [period, setPeriod] = React.useState(30); // 7, 30, 90, or -1 (all)
    const [maxResults, setMaxResults] = React.useState(200);
    const [search, setSearch] = React.useState("");

    const [authorOptions, setAuthorOptions] = React.useState([]); // curated list if provided
    const [tagOptions, setTagOptions] = React.useState([]);       // curated list if provided


    // Load CSV from /public
    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const res = await fetch("/linkedin_posts.csv", { cache: "no-store" });
                if (!res.ok) throw new Error(`HTTP ${res.status} `);
                const text = await res.text();
                const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

                const normalized = (parsed.data || [])
                    .map((r) => normalizeRow(r))
                    .filter((r) => truthyInclude(r.include) && r.title && r.url);

                if (!cancelled) {
                    setRows(normalized);
                    setLoading(false);
                }
            } catch (e) {
                console.warn("linkedin_posts.csv not found:", e);
                if (!cancelled) {
                    setError("linkedin_posts.csv not found.");
                    setRows([]);
                    setLoading(false);
                }
            }
        }
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    // Curated allowlists for dropdowns (use curated if file exists; otherwise fallback)
    React.useEffect(() => {
        let cancelled = false;

        async function loadCuratedOptions() {
            const authorsCSV = await tryFetchCSV("/linkedin_authors.csv");
            const tagsCSV = await tryFetchCSV("/linkedin_tags.csv");

            // If the curated file exists (even if empty), prefer curated list; otherwise fallback to computed
            const useCuratedAuthors = authorsCSV !== null;
            const useCuratedTags = tagsCSV !== null;

            const curatedAuthors = useCuratedAuthors
                ? extractCSVList(authorsCSV, ['author', 'name', 'author_name', 'authors'])
                : [];
            const curatedTags = useCuratedTags
                ? extractCSVList(tagsCSV, ['tag', 'tags', 'topic', 'label'])
                : [];

            const fallbackAuthors = Array.from(new Set(rows.map(r => r.author))).sort((a, b) => a.localeCompare(b));
            const fallbackTags = Array.from(new Set(rows.flatMap(r => r.tags))).sort((a, b) => a.localeCompare(b));

            if (!cancelled) {
                setAuthorOptions(useCuratedAuthors ? curatedAuthors : fallbackAuthors);
                setTagOptions(useCuratedTags ? curatedTags : fallbackTags);
            }
        }

        if (rows.length) {
            loadCuratedOptions();
        } else {
            setAuthorOptions([]);
            setTagOptions([]);
        }

        return () => { cancelled = true; };
    }, [rows]);


    function normalizeRow(r) {
        const include = r.Include ?? r.include ?? r.INCLUDE ?? "";
        const dateRaw = (r.posted_iso || r.post_date_iso || r.date || r.posted || "").trim();
        const dateObj = parseAnyDate(dateRaw);
        const author = (r.author || r.author_name || r.Author || "").trim();
        const title = (r.headline || r.title || "").trim();
        const summary = (r.summary || r.Summary || "").trim();
        const tagsStr = (r.tags || r.Tags || "").toString();
        const tags = tagsStr.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
        const url = (r.post_url || r.url || r.href || "").trim();
        return { include, dateRaw, dateObj, author, title, summary, tags, url };
    }

    const allAuthors = React.useMemo(() => uniqueSorted(rows.map(r => r.author)), [rows]);
    const allTags = React.useMemo(() => uniqueSorted(rows.flatMap(r => r.tags)), [rows]);

    // ⬇️ paste these two effects here
    React.useEffect(() => {
        const allowed = (authorOptions.length ? authorOptions : allAuthors);
        setAuthors(prev => prev.filter(a => allowed.includes(a)));
    }, [authorOptions, allAuthors]);

    React.useEffect(() => {
        const allowed = (tagOptions.length ? tagOptions : allTags);
        setTags(prev => prev.filter(t => allowed.includes(t)));
    }, [tagOptions, allTags]);


    const filtered = React.useMemo(() => {
        let out = rows;

        if (authors.length) out = out.filter((r) => authors.includes(r.author));
        if (tags.length) out = out.filter((r) => r.tags.some((t) => tags.includes(t)));

        if (period > 0) {
            const cutoff = new Date();
            cutoff.setUTCDate(cutoff.getUTCDate() - period);
            out = out.filter((r) => r.dateObj && r.dateObj >= cutoff);
        }

        if (search.trim()) {
            const q = search.trim().toLowerCase();
            out = out.filter(
                (r) =>
                    r.title.toLowerCase().includes(q) ||
                    r.author.toLowerCase().includes(q) ||
                    (r.summary || "").toLowerCase().includes(q) ||
                    r.tags.join(",").toLowerCase().includes(q)
            );
        }

        return [...out].sort((a, b) => {
            const at = a.dateObj ? a.dateObj.getTime() : 0;
            const bt = b.dateObj ? b.dateObj.getTime() : 0;
            if (bt !== at) return bt - at;
            const s = a.author.localeCompare(b.author);
            if (s !== 0) return s;
            return a.title.localeCompare(b.title);
        });
    }, [rows, authors, tags, period, search]);

    const limited = React.useMemo(
        () => (!maxResults || maxResults === -1 ? filtered : filtered.slice(0, maxResults)),
        [filtered, maxResults]
    );

    if (loading) return <div className="p-6 text-sm text-gray-700">Loading LinkedIn posts…</div>;

    return (
        <div className="p-6 space-y-6">
            <header className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">LinkedIn Posts Dashboard</h1>
                <p className="text-sm text-gray-600">
                    Filter by author, tags, and date window. Hover/click any card to read the summary and open the post.
                </p>
                {error && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 inline-block">
                        {error}
                    </div>
                )}
            </header>

            {/* Controls */}
            <section className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1">
                    <label className="block text-xs uppercase text-gray-600">Post Authors</label>
                    <MultiSelect options={authorOptions.length ? authorOptions : allAuthors} selected={authors} onChange={setAuthors} placeholder="All authors" />
                </div>
                <div className="space-y-1">
                    <label className="block text-xs uppercase text-gray-600">Tags</label>
                    <MultiSelect options={tagOptions.length ? tagOptions : allTags} selected={tags} onChange={setTags} placeholder="All tags" />
                </div>
                <div className="space-y-1">
                    <label className="block text-xs uppercase text-gray-600">Search & Filters</label>
                    <div className="flex items-center gap-2">
                        <input
                            className="flex-1 border rounded px-3 py-2 text-sm"
                            placeholder="Search…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <label className="text-xs text-gray-600">Period:</label>
                        <select
                            className="border rounded px-2 py-1 text-sm"
                            value={period}
                            onChange={(e) => setPeriod(Number(e.target.value))}
                        >
                            <option value={7}>Last 7</option>
                            <option value={30}>Last 30</option>
                            <option value={90}>Last 90</option>
                            <option value={-1}>All time</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-gray-600">Max results:</span>
                        <select
                            className="border rounded px-2 py-1 text-sm"
                            value={maxResults}
                            onChange={(e) => setMaxResults(Number(e.target.value))}
                        >
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                            <option value={-1}>All</option>
                        </select>
                        <button
                            className="ml-auto text-xs px-3 py-1.5 border rounded bg-white"
                            onClick={() => {
                                setAuthors([]);
                                setTags([]);
                                setSearch("");
                                setPeriod(30);
                            }}
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </section>

            <div className="text-sm text-gray-700">
                Showing <strong>{limited.length}</strong> of <strong>{filtered.length}</strong> (from {rows.length} total).
            </div>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {limited.map((r, idx) => (
                    <LinkedInCard key={`${r.author}| ${r.title}| ${r.dateRaw}| ${idx} `} row={r} />
                ))}
            </section>
        </div>
    );
}

// -------------------- Card --------------------
function LinkedInCard({ row }) {
    const [open, setOpen] = React.useState(false);
    const [openUp, setOpenUp] = React.useState(false);
    const cardRef = React.useRef(null);

    React.useEffect(() => {
        function onDocClick(e) { if (!cardRef.current) return; if (!cardRef.current.contains(e.target)) setOpen(false); }
        function onKey(e) { if (e.key === 'Escape') setOpen(false); }
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
    }, []);

    function updateOverlayPosition() {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        setOpenUp(rect.bottom + 220 > viewportHeight);
    }

    function handleOpen() { updateOverlayPosition(); setOpen(true); }
    function handleClose() { setOpen(false); }
    function handleCardClick(e) {
        const el = e.target;
        if (el.closest && el.closest('a,button,input,label,textarea,select')) return;
        updateOverlayPosition();
        setOpen((v) => !v);
    }

    return (
        <div
            ref={cardRef}
            className="relative overflow-visible border rounded-2xl p-4 bg-white shadow-sm hover:shadow-md cursor-default"
            onMouseEnter={handleOpen}
            onMouseLeave={handleClose}
            onClick={handleCardClick}
            aria-expanded={open}
        >
            {/* Author + Headline */}
            <div className="mb-1">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">{row.author}</div>
                <div className="text-base font-semibold leading-snug">
                    {row.url ? (
                        <a href={row.url} target="_blank" rel="noreferrer" className="hover:underline">{row.title}</a>
                    ) : row.title}
                </div>
            </div>

            {/* Date */}
            {row.dateObj ? (
                <div className="text-xs text-gray-500 mb-2">{formatDateShort(row.dateObj)}</div>
            ) : row.dateRaw ? (
                <div className="text-xs text-gray-500 mb-2">{row.dateRaw}</div>
            ) : null}

            {/* Tag chips on the card */}
            {row.tags && row.tags.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                    {row.tags.slice(0, 6).map((t) => (
                        <span key={t} className="text-[11px] px-2 py-0.5 border rounded-full">{t}</span>
                    ))}
                    {row.tags.length > 6 && (
                        <span className="text-[11px] px-2 py-0.5 border rounded-full">+{row.tags.length - 6}</span>
                    )}
                </div>
            ) : null}

            {/* Overlay */}
            {open && (
                <div
                    className={`absolute left-0 right-0 rounded-2xl p-4 shadow-xl ring-1 ring-black/10 ${openUp ? 'bottom-0 mb-2' : 'top-0 mt-2'} z-50 mix-blend-normal`}
                    style={{ backgroundColor: '#fff', opacity: 1 }}
                >
                    <div className="text-sm relative">
                        <button
                            className="absolute top-2 right-2 text-xs border rounded px-2 py-0.5 hover:bg-gray-50"
                            onClick={() => setOpen(false)}
                            aria-label="Close details"
                        >
                            ×
                        </button>
                        <div className="font-semibold pr-6">{row.author}</div>
                        <div>{row.title}</div>
                        {row.dateObj ? (
                            <div className="text-xs text-gray-500">{formatDateShort(row.dateObj)}</div>
                        ) : row.dateRaw ? (
                            <div className="text-xs text-gray-500">{row.dateRaw}</div>
                        ) : null}
                        {row.summary && <p className="mt-2 text-gray-700">{row.summary}</p>}
                        {row.tags?.length ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {row.tags.map((t) => (
                                    <span key={t} className="text-[11px] px-2 py-0.5 border rounded-full">
                                        {t}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {row.url && (
                            <p className="mt-2">
                                <a href={row.url} target="_blank" rel="noreferrer" className="underline">
                                    Open LinkedIn post ↗
                                </a>
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function MultiSelect({ options, selected, onChange, placeholder }) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [temp, setTemp] = React.useState([]);
    const rootRef = React.useRef(null);

    function openMenu() {
        setTemp(selected);
        setOpen(true);
    }

    React.useEffect(() => {
        function onDocClick(e) {
            if (!rootRef.current) return;
            if (!rootRef.current.contains(e.target)) setOpen(false);
        }
        function onKey(e) {
            if (e.key === "Escape") setOpen(false);
        }
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onKey);
        };
    }, []);

    const filtered = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    }, [options, query]);

    function toggle(item) {
        const s = new Set(temp);
        s.has(item) ? s.delete(item) : s.add(item);
        setTemp(Array.from(s));
    }
    function apply(closeAfter = false) {
        onChange(temp);
        if (closeAfter) setOpen(false);
    }
    function clear(closeAfter = false) {
        setTemp([]);
        onChange([]);
        if (closeAfter) setOpen(false);
    }

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                className="w-full border rounded px-3 py-2 text-left text-sm flex justify-between"
                onClick={() => {
                    open ? setOpen(false) : openMenu();
                }}
                aria-expanded={open}
            >
                <span>
                    {selected.length ? `${selected.length} selected` : <span className="text-gray-400">{placeholder}</span>}
                </span>
                <span className="text-gray-400">▾</span>
            </button>

            {open && (
                <div className="absolute z-10 mt-2 w-full border rounded bg-white shadow p-2">
                    <div className="flex items-center gap-2 mb-2">
                        <input
                            className="w-full border rounded px-2 py-1 text-sm"
                            placeholder="Filter…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                        <button className="text-xs px-2 py-1 border rounded" onClick={() => clear(false)}>
                            Clear
                        </button>
                    </div>

                    <div className="max-h-48 overflow-auto">
                        {filtered.length ? (
                            filtered.map((opt) => {
                                const isSel = temp.includes(opt);
                                return (
                                    <label key={opt} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer">
                                        <input type="checkbox" checked={isSel} onChange={() => toggle(opt)} />
                                        <span>{opt}</span>
                                    </label>
                                );
                            })
                        ) : (
                            <div className="text-xs text-gray-500 px-2 py-1">No matches</div>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-2">
                        <button className="text-xs px-2 py-1 border rounded" onClick={() => apply(false)}>
                            Apply
                        </button>
                        <button className="text-xs px-2 py-1 border rounded bg-gray-50" onClick={() => apply(true)}>
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
