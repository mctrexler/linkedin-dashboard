"use client";
import React, { useEffect, useState, useMemo } from "react";
import Papa from "papaparse";
import { parseLinkedInRelative } from "../utils/relativeDate";



// -------------------- Helpers --------------------
// ---- helpers (top of file, below imports) ----
function safeTags(row) {
    if (Array.isArray(row?.tags_list)) return row.tags_list.filter(Boolean);

    if (Array.isArray(row?.tags)) {
        return row.tags
            .map((t) => String(t || "").toLowerCase().trim())
            .filter(Boolean);
    }

    return String(row?.tags || "")
        .toLowerCase()
        .split(/[;,]\s*/g)
        .map((t) => t.trim())
        .filter(Boolean);
}


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
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Filters / controls
    const [authors, setAuthors] = useState([]);
    const [tags, setTags] = useState([]);
    const [period, setPeriod] = useState(-1); // All time by default
    const [maxResults, setMaxResults] = useState(200);
    const [search, setSearch] = useState("");

    const [authorOptions, setAuthorOptions] = useState([]); // curated list if provided
    const [tagOptions, setTagOptions] = useState([]);       // curated list if provided


    // Credentials and unpublished rows remain on the server.
    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const data = { posts: [] };
                let page = 0;
                do {
                    const response = await fetch('/api/posts?page=' + page, { signal: controller.signal });
                    const batch = await response.json();
                    if (!response.ok) throw new Error(batch.error || 'Collection unavailable');
                    data.posts.push(...batch.posts);
                    page = batch.nextPage;
                } while (page !== null);
                setRows(data.posts.map(r => ({ ...r,
                    posted_at: r.posted_iso ? new Date(r.posted_iso + 'T00:00:00Z') : null,
                    posted_iso_abs: r.posted_iso,
                    tags_list: r.tags.toLowerCase().split(/[;,]/).map(t => t.trim()).filter(Boolean)
                })));
                const [authorRows, tagRows] = await Promise.all([tryFetchCSV('/linkedin_authors.csv'), tryFetchCSV('/linkedin_tags.csv')]);
                if (!authorRows || !tagRows) throw new Error('Featured filter lists unavailable. Please reload.');
                setAuthorOptions(extractCSVList(authorRows, ['author']));
                setTagOptions(extractCSVList(tagRows, ['tag']));
            } catch (e) {
                if (e.name !== 'AbortError') setError(e.message);
            } finally { setLoading(false); }
        }
        load();
        return () => controller.abort();
    }, []);

    function normalizeRow(r) {
        const include = r.Include ?? r.include ?? r.INCLUDE ?? "";
        const dateRaw = (r.posted_at || r.post_date_iso || r.date || r.posted || "").trim();
        const dateObj = parseAnyDate(dateRaw);
        const author = (r.author || r.author_name || r.Author || "").trim();
        const title = (r.headline || r.title || "").trim();
        const summary = (r.summary || r.Summary || "").trim();
        const tagsStr = (r.tags || r.Tags || "").toString();
        const tags = tagsStr.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
        const url = (r.post_url || r.url || r.href || "").trim();
        return { include, dateRaw, dateObj, author, title, summary, tags, url };
    }

    const allAuthors = useMemo(() => uniqueSorted(rows.map(r => r.author)), [rows]);
    const allTags = useMemo(() => uniqueSorted(rows.flatMap(r => r.tags)), [rows]);

    // ⬇️ paste these two effects here
    useEffect(() => {
        const allowed = (authorOptions);
        setAuthors(prev => prev.filter(a => allowed.includes(a)));
    }, [authorOptions, allAuthors]);

    useEffect(() => {
        const allowed = (tagOptions);
        setTags(prev => prev.filter(t => allowed.includes(t)));
    }, [tagOptions, allTags]);


    const filtered = useMemo(() => {
        let out = rows;

        // helper to normalize text once
        const norm = (s) => String(s || "").trim().toLowerCase();

        // --- normalize period (supports 30, "30", "30d", "all", "all time", "any") ---
        const pStr = typeof period === "string" ? norm(period) : period;
        let p = pStr;
        if (typeof pStr === "string") {
            if (/^(all|any|all\s*time)$/.test(pStr)) {
                p = "all";
            } else {
                const m = pStr.match(/^(\d+)\s*d?$/i);
                p = m ? Number(m[1]) : "all";
            }
        }

        // Include flag: only drop explicit 'n'; keep others (fail open)
        out = out.filter((r) => (r.include ?? "y") !== "n");

        // Authors (case-insensitive)
        if (authors && authors.length) {
            const want = new Set(authors.map(norm));
            out = out.filter((r) => want.has(norm(r.author)));
        }

        // Tags: prefer pre-split r.tags_list; fallback to splitting r.tags string
        const tagsOf = (r) =>
            Array.isArray(r?.tags_list)
                ? r.tags_list
                : norm(r?.tags || "")
                    .split(/[;,]\s*/g)
                    .map((t) => t.trim())
                    .filter(Boolean);

        if (tags && tags.length) {
            const want = new Set(tags.map(norm));
            out = out.filter((r) => tagsOf(r).some((t) => want.has(t)));
        }

        // Period filter (p is either "all" or a number of days). If no parsed date, KEEP the row (fail open).
        if (p && p !== "all") {
            const days = Number(p);
            if (!Number.isNaN(days) && days > 0) {
                const cutoff = Date.now() - days * 86400000;
                out = out.filter((r) => {
                    const t =
                        r.posted_at instanceof Date && !isNaN(r.posted_at)
                            ? r.posted_at.getTime()
                            : r.dateObj instanceof Date && !isNaN(r.dateObj) // legacy fallback
                                ? r.dateObj.getTime()
                                : NaN;
                    if (isNaN(t)) return false; // Week-only records remain available under All time
                    return t >= cutoff;
                });
            }
        }

        // Search across headline/summary/author/tags (using tagsOf to avoid string/array issues)
        if (search?.trim()) {
            const q = norm(search);
            out = out.filter((r) => {
                const tagText = safeTags(r).join(" ");
                const hay = [r.headline, r.title, r.summary, r.full_summary, r.author, tagText]
                    .map(norm)
                    .join(" ");
                return hay.includes(q);
            });
        }

        // Sort: newest first (posted_at/dateObj), then author, then headline/title
        return [...out].sort((a, b) => {
            const ta =
                a.posted_at instanceof Date && !isNaN(a.posted_at)
                    ? a.posted_at.getTime()
                    : a.dateObj instanceof Date && !isNaN(a.dateObj)
                        ? a.dateObj.getTime()
                        : 0;

            const tb =
                b.posted_at instanceof Date && !isNaN(b.posted_at)
                    ? b.posted_at.getTime()
                    : b.dateObj instanceof Date && !isNaN(b.dateObj)
                        ? b.dateObj.getTime()
                        : 0;

            if (tb !== ta) return tb - ta;

            const s = String(a.author || "").localeCompare(String(b.author || ""));
            if (s !== 0) return s;

            return String(a.headline || a.title || "").localeCompare(
                String(b.headline || b.title || "")
            );
        });
    }, [rows, authors, tags, period, search]);



    const limited = useMemo(
        () => (!maxResults || maxResults === -1 ? filtered : filtered.slice(0, maxResults)),
        [filtered, maxResults]
    );

    if (loading) return <div className="p-6 text-sm text-gray-700">Loading LinkedIn posts…</div>;

    return (
        <div className="p-6 space-y-6">
            <header className="rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-8 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">A curated collection from the Climatographers</p>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">Climate Change on LinkedIn: Post Explorer</h1>
                <p className="max-w-4xl text-base sm:text-lg leading-relaxed text-slate-700">Discover climate conversations you might otherwise miss. Browse recent posts, explore a topic, or find contributions from a particular author—then follow the links to read, engage, and join the conversation on LinkedIn.</p>
                <div className="grid gap-4 lg:grid-cols-2 text-sm leading-relaxed text-slate-600">
                    <p>This explorer complements the Climatographers’ short LinkedIn post reviews and our <em>Climate Change on LinkedIn</em> newsletter. It also offers a different experience from our Gemini Notebook: the Notebook helps weave connections and stories across post summaries; this tool helps you browse and locate individual posts.</p>
                    <p>This is a selective collection, not a comprehensive archive of climate content on LinkedIn. We add dozens of posts each week, using short summaries and topic tags to make worthwhile contributions easier to discover.</p>
                </div>
                <p className="border-t border-slate-200 pt-4 text-sm leading-relaxed text-slate-700"><strong>Our purpose is discovery that leads back to LinkedIn.</strong> The summaries help you decide what interests you; each post’s title takes you directly to the original, where the full content and conversation belong.</p>
                {error && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 inline-block">{error}</div>}
            </header>
            <p className="text-sm leading-relaxed text-gray-600">Browse by author or topic, search the collection, or select a date window. Choose “Read full summary” for more context; click a post title to open LinkedIn.</p>

            {/* Controls */}
            <section className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1">
                    <label className="block text-xs uppercase text-gray-600">Post Authors</label>
                    <MultiSelect options={authorOptions} selected={authors} onChange={setAuthors} placeholder="All authors" />
                </div>
                <div className="space-y-1">
                    <label className="block text-xs uppercase text-gray-600">Tags</label>
                    <MultiSelect options={tagOptions} selected={tags} onChange={setTags} placeholder="All tags" />
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
                                setPeriod(-1);
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

            {!error && rows.length === 0 && <p>No posts have been published to this collection yet.</p>}
            {!error && rows.length > 0 && limited.length === 0 && <p>No posts match these filters. Try All time or reset the filters.</p>}
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
    const [open, setOpen] = useState(false);
    const [openUp, setOpenUp] = useState(false);
    const [showFull, setShowFull] = useState(false);
    const cardRef = React.useRef(null);

    useEffect(() => {
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
                <div className="text-[11px] uppercase tracking-wide text-gray-500">
                    {row.author || "(unknown)"}
                </div>
                <div className="text-base font-semibold leading-snug">
                    {row.url ? (
                        <a href={row.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {row.headline || row.title || "(no title)"}
                        </a>
                    ) : (row.headline || row.title || "(no title)")}
                </div>
            </div>

            <button className="text-sm underline mt-2" onClick={() => { setOpen(false); setShowFull(true); }}>Read full summary</button>
            {showFull && <SummaryDialog row={row} onClose={() => setShowFull(false)} />}
            {/* Date */}
            {(() => {
                const isValid = (d) => d instanceof Date && !isNaN(d.getTime());
                let when = "";

                if (isValid(row?.posted_at)) {
                    when = typeof formatDateShort === "function"
                        ? formatDateShort(row.posted_at)
                        : `${row.posted_at.getFullYear()}-${String(row.posted_at.getMonth() + 1).padStart(2, "0")}-${String(row.posted_at.getDate()).padStart(2, "0")}`;
                } else if (isValid(row?.dateObj)) {
                    when = typeof formatDateShort === "function"
                        ? formatDateShort(row.dateObj)
                        : `${row.dateObj.getFullYear()}-${String(row.dateObj.getMonth() + 1).padStart(2, "0")}-${String(row.dateObj.getDate()).padStart(2, "0")}`;
                } else {
                    when = row?.posted_iso_abs || row?.iso_week || "";
                }

                return when ? <div className="text-xs text-gray-500 mb-2">{when}</div> : null;
            })()}


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
                        <div>{row.headline || row.title}</div>
                        {row.dateObj ? (
                            <div className="text-xs text-gray-500">{formatDateShort(row.dateObj)}</div>
                        ) : row.dateRaw ? (
                            <div className="text-xs text-gray-500">{row.dateRaw}</div>
                        ) : null}
                        {row.summary && <p className="mt-2 text-gray-700">{row.summary}</p>}
                        <button className="text-sm underline mt-2" onClick={() => { setOpen(false); setShowFull(true); }}>Read full summary</button>
                        {row.tags?.length ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {safeTags(row).map((t) => (
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

// --- MultiSelect (top-level component; not nested inside another function) ---
function MultiSelect({ options = [], selected = [], onChange, placeholder = "Select…" }) {
    const rootRef = React.useRef(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [temp, setTemp] = useState(selected);

    // keep temp in sync if parent selection changes
    useEffect(() => {
        setTemp(selected);
    }, [selected]);

    // close on outside click / Escape
    useEffect(() => {
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

    // filter options by query
    const filtered = useMemo(() => {
        const list = Array.isArray(options) ? options : [];
        const q = (query || "").trim().toLowerCase();
        return q ? list.filter((o) => String(o).toLowerCase().includes(q)) : list;
    }, [options, query]);

    function toggle(item) {
        setTemp((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
    }
    function apply(closeAfter = true) {
        onChange?.(temp);
        if (closeAfter) setOpen(false);
    }
    function clear(closeAfter = false) {
        setTemp([]);
        onChange?.([]);
        if (closeAfter) setOpen(false);
    }
    function openMenu() {
        setOpen(true);
        setQuery("");
        setTemp(selected);
    }

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                className="w-full border rounded px-3 py-2 text-left text-sm flex justify-between"
                onClick={() => (open ? setOpen(false) : openMenu())}
                aria-expanded={open}
            >
                <span>
                    {selected.length ? (
                        `${selected.length} selected`
                    ) : (
                        <span className="text-gray-400">{placeholder}</span>
                    )}
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

function SummaryDialog({ row, onClose }) {
    const ref = React.useRef(null);
    useEffect(() => {
        const prior = document.activeElement;
        ref.current?.showModal();
        return () => { ref.current?.close(); prior?.focus(); };
    }, []);
    return <dialog ref={ref} onCancel={onClose} className="rounded-xl p-6 w-full max-w-3xl max-h-[90vh] backdrop:bg-black/40" aria-label={row.headline}>
        <button className="float-right border rounded px-3 py-1" onClick={onClose}>Close</button>
        <h2 className="text-xl font-semibold pr-20">{row.headline}</h2>
        <p className="mt-2 text-sm text-gray-500">{row.author}</p>
        <a className="inline-block underline my-4" href={row.url} target="_blank" rel="noreferrer">Open original LinkedIn post</a>
        <div className="whitespace-pre-wrap break-words text-sm leading-7">{row.full_summary || row.summary}</div>
    </dialog>;
}
