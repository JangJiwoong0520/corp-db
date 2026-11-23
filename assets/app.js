"use strict";
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const has = (v) => v !== undefined && v !== null && v !== "";
  const fmt = (v, d = 0) => (has(v) ? Number(v).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d }) : "");
  const DASH = '<span class="dash">–</span>';
  const num = (v, d = 0) => (has(v) ? `<span class="${v < 0 ? "neg" : ""}">${fmt(v, d)}</span>` : DASH);
  // 억원 → "1.2조" / "3,450억"
  const won = (v) => (!has(v) ? "" : Math.abs(v) >= 10000 ? `${fmt(v / 10000, 1)}조` : `${fmt(v)}억`);
  const date8 = (s) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s || "");
  const MARKET = { Y: "코스피", K: "코스닥", N: "코넥스" };
  const EVN = { CB: "CB", BW: "BW", EB: "EB", RI: "유상증자", TQ: "자사주 취득" };
  const EVC = { CB: "mz", BW: "mz", EB: "mz", RI: "ri", TQ: "tq" };
  const dartLink = (rc) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rc)}`;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const mk = (m) => (MARKET[m] ? `<span class="mk ${m}">${MARKET[m]}</span>` : "");
  const sub = (r) => [r.ind, has(r.age) ? `대표 ${r.age}세` : "", r.reg].filter(Boolean).map(esc).join(" · ");

  let LISTED = [], IPO = [], META = {};

  // ── 라이트/다크 모드 (기본 라이트, 선택은 이 기기에 저장) ──
  function applyMode(mode) {
    const dark = mode === "dark";
    if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    $(".mode-ico").textContent = dark ? "☀️" : "🌙";
    $(".mode-txt").textContent = dark ? "라이트 모드" : "다크 모드";
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? "#0f2a1c" : "#14532d";
  }
  applyMode(store.get("theme") === "dark" ? "dark" : "light");
  $("#mode").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    store.set("theme", next); applyMode(next);
  });

  // ── 탭 ──
  function showTab(name) {
    $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    $("#tab-listed").hidden = name !== "listed";
    $("#tab-ipo").hidden = name !== "ipo";
    store.set("tab", name);
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ── 상장사: 필터 상태 ──
  const F = { q: "", market: "", flags: new Set(), rev: NaN, cash: NaN, cap: NaN };
  const FLAG = {
    mz: (r) => !!r.mz, ri: (r) => !!r.ri, tq: (r) => !!r.tq,
    age: (r) => r.age >= 60, bond: (r) => r.bond > 0, chg: (r) => r.chg > 0,
  };
  const KPIS = [
    { f: null, t: "상장사", s: "코스피·코스닥·코넥스" },
    { f: "mz", t: "메자닌 발행", s: "최근 3년 CB·BW·EB" },
    { f: "ri", t: "유상증자", s: "최근 3년 결정" },
    { f: "tq", t: "자사주 취득", s: "최근 1년 결정" },
    { f: "age", t: "대표 60세 이상", s: "사업보고서 임원 현황" },
  ];
  function renderKpis() {
    $("#kpis").innerHTML = KPIS.map((k) => {
      const n = k.f ? LISTED.filter(FLAG[k.f]).length : LISTED.length;
      const on = k.f ? F.flags.has(k.f) : F.flags.size === 0 && !F.q && !F.market;
      return `<button class="kpi" data-f="${k.f || ""}" aria-pressed="${on}"><span class="t">${k.t}</span><b>${fmt(n)}<small>곳</small></b><span class="s">${k.s}</span></button>`;
    }).join("");
  }
  $("#kpis").addEventListener("click", (e) => {
    const b = e.target.closest(".kpi"); if (!b) return;
    const f = b.dataset.f;
    if (!f) { resetFilters(); return; }
    F.flags.has(f) ? F.flags.delete(f) : F.flags.add(f);
    syncChips(); page = 1; renderListed();
  });

  function syncChips() {
    $$("#chips button[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(F.flags.has(b.dataset.f))));
    $$("#f-market button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === F.market)));
  }
  function resetFilters() {
    F.q = ""; F.market = ""; F.flags.clear(); F.rev = NaN; F.cash = NaN; F.cap = NaN;
    $("#q").value = ""; $("#f-rev").value = ""; $("#f-cash").value = ""; $("#f-cap").value = "";
    syncChips(); page = 1; renderListed();
  }
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    const f = b.dataset.f; F.flags.has(f) ? F.flags.delete(f) : F.flags.add(f);
    syncChips(); page = 1; renderListed();
  });
  $("#f-market").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    F.market = b.dataset.v; syncChips(); page = 1; renderListed();
  });
  $("#q").addEventListener("input", (e) => { F.q = e.target.value.trim().toLowerCase(); page = 1; renderListed(); });
  $("#f-rev").addEventListener("input", (e) => { F.rev = parseFloat(e.target.value); page = 1; renderListed(); });
  $("#f-cash").addEventListener("input", (e) => { F.cash = parseFloat(e.target.value); page = 1; renderListed(); });
  $("#f-cap").addEventListener("input", (e) => { F.cap = parseFloat(e.target.value); page = 1; renderListed(); });
  $("#f-reset").addEventListener("click", resetFilters);

  function filtered() {
    return LISTED.filter((r) => {
      if (F.q && ![r.n, r.s, r.ind, r.ceo, r.mh].some((x) => String(x || "").toLowerCase().includes(F.q))) return false;
      if (F.market && r.m !== F.market) return false;
      if (!isNaN(F.rev) && !(r.rev >= F.rev)) return false;
      if (!isNaN(F.cash) && !(r.cash >= F.cash)) return false;
      if (!isNaN(F.cap) && !(r.cap >= F.cap)) return false;
      for (const f of F.flags) if (!FLAG[f](r)) return false;
      return true;
    });
  }

  // ── 상장사: 표·카드 ──
  const SORTV = {
    n: (r) => r.n, cap: (r) => r.cap, rev: (r) => r.rev, op: (r) => r.op, cash: (r) => r.cash, dr: (r) => r.dr, mhr: (r) => r.mhr,
    tsr: (r) => r.tsr, age: (r) => r.age, bond: (r) => r.bond, mz: (r) => (r.mz ? r.mz[0] : null),
  };
  const COLS = [
    { k: "n", t: "회사", cls: "l co" },
    { k: "cap", t: "시총", u: "억원" },
    { k: "rev", t: "매출", u: "억원" },
    { k: "op", t: "영업이익", u: "억원 · 이익률" },
    { k: "cash", t: "현금성자산", u: "억원" },
    { k: "dr", t: "부채비율", u: "%" },
    { k: "mhr", t: "최대주주+특관", u: "%", cls: "l" },
    { k: "tsr", t: "자사주", u: "%" },
    { k: "mz", t: "자금조달·주주환원", cls: "l", u: "건·금액" },
    { k: "bond", t: "회사채 잔액", u: "억원" },
  ];
  let sortKey = store.get("sort3") || "cap", sortAsc = store.get("asc3") === "1", page = 1;
  const PER = 40;
  $("#sort").value = sortKey;

  function pills(r) {
    const p = [];
    if (r.mz) p.push(`<span class="pill mz">메자닌 ${r.mz[0]}건${r.mz[1] ? " · " + won(r.mz[1]) : ""}</span>`);
    if (r.ri) p.push(`<span class="pill ri">유증 ${r.ri[0]}건${r.ri[1] ? " · " + won(r.ri[1]) : ""}</span>`);
    if (r.tq) p.push(`<span class="pill tq">자사주 ${r.tq[0]}건${r.tq[1] ? " · " + won(r.tq[1]) : ""}</span>`);
    return p.length ? `<div class="pills">${p.join("")}</div>` : DASH;
  }
  const barCell = (v) => (has(v) ? `<span class="bar"><i style="--w:${Math.max(0, Math.min(100, v))}%"></i>${fmt(v, 1)}</span>` : DASH);

  function rowHtml(r) {
    return `<tr data-c="${esc(r.c)}">
      <td class="l co"><span class="nm">${esc(r.n)} ${mk(r.m)}</span><span class="sub">${sub(r) || "&nbsp;"}</span></td>
      <td class="capc">${num(r.cap)}</td>
      <td>${num(r.rev)}</td>
      <td>${num(r.op)}${has(r.opm) ? `<span class="cell-sub">${fmt(r.opm, 1)}%</span>` : ""}</td>
      <td>${num(r.cash)}</td>
      <td>${num(r.dr)}</td>
      <td class="l">${barCell(r.mhr)}</td>
      <td>${num(r.tsr, 1)}</td>
      <td class="l">${pills(r)}</td>
      <td>${num(r.bond)}</td></tr>`;
  }
  function cardHtml(r) {
    const m = (label, v) => `<div class="metric"><span>${label}</span><b>${v}</b></div>`;
    return `<button class="card" data-c="${esc(r.c)}">
      <div class="top"><div><div class="nm">${esc(r.n)}</div><div class="sub">${sub(r)}</div></div>${mk(r.m)}</div>
      <div class="metrics">${m("시총", has(r.cap) ? won(r.cap) : "–")}${m("매출", has(r.rev) ? won(r.rev) : "–")}${m("영업이익", has(r.op) ? won(r.op) : "–")}${m("현금성자산", has(r.cash) ? won(r.cash) : "–")}</div>
      ${r.mz || r.ri || r.tq ? pills(r) : ""}</button>`;
  }

  function renderListed() {
    const get = SORTV[sortKey] || SORTV.rev;
    const rows = filtered().sort((a, b) => {
      const x = get(a), y = get(b);
      if (!has(x) && !has(y)) return 0; if (!has(x)) return 1; if (!has(y)) return -1;
      const c = typeof x === "string" ? x.localeCompare(y, "ko") : x - y;
      return sortAsc ? c : -c;
    });
    const pages = Math.max(1, Math.ceil(rows.length / PER));
    page = Math.min(page, pages);
    const slice = rows.slice((page - 1) * PER, page * PER);
    $("#count").innerHTML = `${fmt(rows.length)}곳 · 회사를 누르면 상세 정보` +
      (sortKey !== DEFAULT_SORT || sortAsc ? ` · <button class="linkbtn" id="sort-reset">정렬 해제</button>` : "");
    $("#t-listed thead").innerHTML = "<tr>" + COLS.map((c) => `<th class="${c.cls || ""} ${c.k === sortKey ? "sorted" + (sortAsc ? " asc" : "") : ""}" data-k="${c.k}">${c.t}${c.u ? `<span class="u">${c.u}</span>` : ""}</th>`).join("") + "</tr>";
    $("#t-listed tbody").innerHTML = slice.map(rowHtml).join("") || `<tr><td class="l" colspan="9">조건에 맞는 회사가 없습니다</td></tr>`;
    $("#c-listed").innerHTML = slice.map(cardHtml).join("") || `<p class="note">조건에 맞는 회사가 없습니다</p>`;
    const btn = (p, label = p) => `<button data-p="${p}" ${p === page ? 'aria-current="true"' : ""}>${label}</button>`;
    let pg = "";
    if (pages > 1) {
      const lo = Math.max(1, page - 2), hi = Math.min(pages, page + 2);
      if (lo > 1) pg += btn(1, "«");
      for (let p = lo; p <= hi; p++) pg += btn(p);
      if (hi < pages) pg += btn(pages, "»");
    }
    $("#pager").innerHTML = pg;
    renderKpis();
  }
  const DEFAULT_SORT = "cap";
  function setSort(k, toggle) {
    const firstAsc = k === "n";
    if (toggle && k === sortKey && k !== DEFAULT_SORT) {
      // 같은 머리글을 다시 누르면: 처음 방향 → 반대 방향 → 기본 정렬(시총 큰 순)
      if (sortAsc === firstAsc) sortAsc = !firstAsc; else { sortKey = DEFAULT_SORT; sortAsc = false; }
    } else if (toggle && k === sortKey) {
      sortAsc = !sortAsc;
    } else { sortKey = k; sortAsc = firstAsc; }
    if ([...$("#sort").options].some((o) => o.value === sortKey)) $("#sort").value = sortKey;
    store.set("sort3", sortKey); store.set("asc3", sortAsc ? "1" : "0");
    page = 1; renderListed();
  }
  $("#t-listed thead").addEventListener("click", (e) => { const k = e.target.closest("th")?.dataset.k; if (k && SORTV[k]) setSort(k, true); });
  $("#sort").addEventListener("change", (e) => setSort(e.target.value, false));
  $("#count").addEventListener("click", (e) => { if (e.target.id === "sort-reset") setSort(DEFAULT_SORT, false); });
  $("#pager").addEventListener("click", (e) => { const p = e.target.closest("button")?.dataset.p; if (p) { page = +p; renderListed(); $("#count").scrollIntoView({ block: "start", behavior: "smooth" }); } });
  const openFromEvent = (e) => { const c = e.target.closest("[data-c]")?.dataset.c; if (c) openCompany(c); };
  $("#t-listed tbody").addEventListener("click", openFromEvent);
  $("#c-listed").addEventListener("click", openFromEvent);

  // ── 상세 창 ──
  const kv = (pairs) => {
    const items = pairs.filter(([, v]) => has(v));
    return items.length ? `<div class="panel"><dl class="kv">${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>` : '<p class="note">자료 없음</p>';
  };
  const sec = (no, title, body) => `<h2 class="sec"><span>${no}</span>${title}</h2>${body}`;
  function openSheet(html) { $("#sheet-content").innerHTML = html; $("#sheet").hidden = false; $(".sheet-body").scrollTop = 0; }
  const closeSheet = () => ($("#sheet").hidden = true);
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  function openCompany(c) {
    const r = LISTED.find((x) => x.c === c); if (!r) return;
    const pct = (v, d = 1) => (has(v) ? `${fmt(v, d)}%` : "");
    const tile = (t, v, s) => `<div class="kpi"><span class="t">${t}</span><b>${v || "–"}</b><span class="s">${s || ""}</span></div>`;
    const ev = (r.evl || []).map((e) => `<li class="${EVC[e[1]] || ""}"><span class="when">${date8(e[0])}</span><strong>${EVN[e[1]] || e[1]}</strong>${e[3] ? `<span>${won(e[3])}</span>` : ""}<a href="${dartLink(e[2])}" target="_blank" rel="noopener">원문 ↗</a></li>`).join("");
    openSheet(`
      <div class="sh-head"><p class="eyebrow">${esc(MARKET[r.m] || "")} · ${esc(r.s)}</p><h2>${esc(r.n)}</h2>
        <div class="sub">${sub(r)}</div>
        <div class="sh-links"><a href="https://finance.naver.com/item/main.naver?code=${encodeURIComponent(r.s)}" target="_blank" rel="noopener">시세 보기 ↗</a>
        ${r.lr ? `<a href="${dartLink(r.lr[2])}" target="_blank" rel="noopener">최근 정기보고서 ↗</a>` : ""}${contactLinks(r)}</div></div>
      <div class="sh-body">
        <div class="sh-kpis">${tile("시가총액", won(r.cap), META.cap_date ? `${date8(META.cap_date)} 종가 기준` : "")}${tile("매출", won(r.rev), esc(r.fyl || (r.fy ? `${r.fy} 사업보고서` : "")))}${tile("영업이익", won(r.op), has(r.opm) ? `이익률 ${fmt(r.opm, 1)}%` : "")}${tile("현금성자산", won(r.cash), "연결 우선")}${tile("최대주주+특관", pct(r.mhr), esc(r.mh || ""))}${tile("부채비율", pct(r.dr, 0), "")}</div>
        ${sec("01", "기본 정보", kv([["대표", esc(r.ceo)], ["대표 나이", has(r.age) ? `${r.age}세` : ""], ["업종", esc(r.ind)], ["지역", esc(r.reg)], ["설립일", date8(r.est)], ["결산월", r.acc ? `${r.acc}월` : ""], ["감사인", esc(r.aud)], ["감사의견", esc(r.audop)], ...contactKv(r)]))}
        ${sec("02", `재무 <small>${esc(r.fyl || (r.fy ? r.fy + " 사업보고서" : "자료 없음"))} · 억원</small>`, kv([["매출", fmt(r.rev)], ["영업이익", fmt(r.op)], ["당기순이익", fmt(r.ni)], ["자산총계", fmt(r.ta)], ["부채총계", fmt(r.tl)], ["자본총계", fmt(r.te)], ["부채비율", pct(r.dr, 0)], ["현금성자산", fmt(r.cash)], ["회사채 미상환", fmt(r.bond)]]))}
        ${sec("03", `주주·자본${r.perl ? ` <small>${esc(r.perl)}</small>` : ""}`, kv([["최대주주", esc(r.mh)], ["최대주주+특관 지분", pct(r.mhr, 2)], ["최대주주 변동", has(r.chg) ? `${r.chg}건 (해당 사업연도)` : ""], ["발행주식수", has(r.sh) ? `${fmt(r.sh)}주` : ""], ["자기주식 비율", pct(r.tsr, 2)], ["현금배당성향", pct(r.pay)]]))}
        ${sec("04", "임직원", kv([["직원 수", has(r.emp) ? `${fmt(r.emp)}명` : ""], ["1인 평균 급여", has(r.sal) ? `${fmt(r.sal)}백만원` : ""], ["평균 근속", has(r.ten) ? `${fmt(r.ten, 1)}년` : ""]]))}
        ${r.lr ? `<p class="note">최근 정기보고서: ${date8(r.lr[0])} · ${esc(r.lr[1])}</p>` : ""}
        ${sec("05", "주요사항보고서 <small>최근 3년</small>", ev ? `<div class="panel"><ul class="timeline">${ev}</ul></div>` : '<p class="note">최근 3년 CB·BW·EB·유상증자·자사주 취득 결정 없음</p>')}
      </div>`);
  }

  // ── 공모 ──
  const STAGES = ["증권신고서", "수요예측", "청약예정", "청약중", "납입·상장대기", "상장", "철회"];
  const stageSel = new Set(STAGES.filter((s) => s !== "철회"));
  let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const EVL = { sub: "청약", pay: "납입", lst: "상장" };
  const md = (k) => (k ? `${k.slice(5, 7)}.${k.slice(8, 10)}` : "");
  // "12.07~08" (같은 달) / "11.30~12.01"
  const rng = (a) => { if (!a || !a.length) return ""; const s = a[0], e = a[a.length - 1]; return s === e ? md(s) : `${md(s)}~${s.slice(0, 7) === e.slice(0, 7) ? e.slice(8, 10) : md(e)}`; };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const telHref = (t) => `tel:${String(t).replace(/[^0-9+]/g, "")}`;
  // 홈페이지·IR·대표번호 버튼 (DART 기업개황)
  const contactLinks = (r) => [
    safeUrl(r.hm) && `<a href="${esc(safeUrl(r.hm))}" target="_blank" rel="noopener">홈페이지 ↗</a>`,
    safeUrl(r.ir) && `<a href="${esc(safeUrl(r.ir))}" target="_blank" rel="noopener">IR 페이지 ↗</a>`,
    r.tel && `<a href="${esc(telHref(r.tel))}">☎ ${esc(r.tel)}</a>`,
  ].filter(Boolean).join("");
  const contactKv = (r) => [
    ["대표번호", r.tel ? `<a class="lk" href="${esc(telHref(r.tel))}">${esc(r.tel)}</a>` : ""],
    ["홈페이지", safeUrl(r.hm) ? `<a class="lk" href="${esc(safeUrl(r.hm))}" target="_blank" rel="noopener">${esc(r.hm.replace(/^https?:\/\//i, "").replace(/\/$/, ""))}</a>` : ""],
    ["IR 페이지", safeUrl(r.ir) ? `<a class="lk" href="${esc(safeUrl(r.ir))}" target="_blank" rel="noopener">${esc(r.ir.replace(/^https?:\/\//i, "").replace(/\/$/, ""))}</a>` : ""],
  ];

  // ── 회사별 공모 진행 단계 (신고서 → 수요예측 → 청약 → 납입 → 상장) ──
  const STEPS = ["신고서", "수요예측", "청약", "납입", "상장"];
  function stepPos(r) { // [현재 칸, 예정(아직 시작 전)인지]
    const t = keyOf(new Date());
    switch (r.stage) {
      case "증권신고서": return [0, false];
      case "수요예측": return [1, false];
      case "청약예정": return [2, true];
      case "청약중": return [2, false];
      case "납입·상장대기": return r.pymd && r.pymd <= t ? [4, true] : [3, true];
      case "상장": return [4, false];
      default: return [-1, false];
    }
  }
  function stepper(r, big) {
    const [cur, pend] = stepPos(r), off = r.stage === "철회";
    const dates = [md(date8(r.first)), "", rng(r.sbd), md(r.pymd), md(r.lst)];
    const li = STEPS.map((s, i) => {
      const st = off ? "" : i < cur || (i === cur && r.stage === "상장") ? "done" : i === cur ? (pend ? "next" : "cur") : "";
      return `<li class="${st}"><i></i><span>${s}</span>${big ? `<small>${dates[i] || "&nbsp;"}</small>` : ""}</li>`;
    }).join("");
    return `<ol class="steps${big ? " big" : ""}${off ? " off" : ""}" aria-label="공모 진행 단계: ${esc(r.stage)}">${li}</ol>`;
  }

  // ── 공모 탭 거르기: 단계 · 검색 · 스팩 ──
  let ipoQ = "";
  let showSpac = store.get("spac") !== "off";
  const ipoBase = () => {
    const q = ipoQ.trim().toLowerCase();
    return IPO.filter((r) => (showSpac || !r.spac) && (!q || [r.n, r.s, r.ceo, ...(r.lead || [])].some((v) => String(v || "").toLowerCase().includes(q))));
  };

  // 일정 → [시작일, 종료일, 종류, 회사]
  function ipoEvents(rows) {
    const evs = [];
    rows.forEach((r) => {
      const s = r.sbd || [];
      if (s.length) evs.push([s[0], s[s.length - 1], "sub", r]);
      if (r.pymd) evs.push([r.pymd, r.pymd, "pay", r]);
      if (r.lst) evs.push([r.lst, r.lst, "lst", r]);
    });
    return evs;
  }
  function renderIpo() {
    const base = ipoBase();
    const counts = Object.fromEntries(STAGES.map((s) => [s, base.filter((r) => r.stage === s).length]));
    $("#stages").innerHTML = STAGES.map((s, i) => `<li><button data-s="${s}" aria-pressed="${stageSel.has(s)}"><span class="step">STEP ${pad(i + 1)}</span><span class="lab">${s}</span><b>${counts[s]}</b></button></li>`).join("");
    $("#f-spac").setAttribute("aria-pressed", String(showSpac));
    const rows = base.filter((r) => stageSel.has(r.stage));
    const evs = ipoEvents(rows);
    $("#ipo-count").textContent = ipoQ.trim() || !showSpac ? `${fmt(rows.length)}곳 표시 (검색·스팩 조건 적용)` : "";

    const today = keyOf(new Date());
    const until = (() => { const d = new Date(); d.setDate(d.getDate() + 14); return keyOf(d); })();
    const up = evs.filter(([a, b]) => b >= today && a <= until).sort((x, y) => (x[0] < today ? today : x[0]).localeCompare(y[0] < today ? today : y[0]));
    $("#upcoming").innerHTML = up.map(([a, b, t, r]) => { const d = dayOf(a);
      const ongoing = a < today ? " ing" : "";
      return `<li data-c="${esc(r.c)}" class="${ongoing}"><span class="d">${a === b ? md(a) : rng([a, b])}<small>${DOW[d.getDay()]}${a === b ? "" : "~" + DOW[dayOf(b).getDay()]}</small></span><span class="tagx ${t}">${EVL[t]}${ongoing ? " 중" : ""}</span><span class="n">${esc(r.n)}${r.spac ? ' <span class="mk">스팩</span>' : ""}</span><span class="x">${r.price ? fmt(r.price) + "원" : ""}${r.total ? " · " + won(r.total) : ""}</span></li>`; }).join("")
      || '<li><span class="empty">앞으로 14일 안에 청약·납입·상장 일정이 없습니다</span></li>';

    renderCal(evs);
    const tr = (r) => `<tr data-c="${esc(r.c)}"><td class="l co"><span class="nm">${esc(r.n)}${r.spac ? ' <span class="mk">스팩</span>' : ""}</span><span class="sub">${esc((r.lead || []).join(", ")) || "&nbsp;"}</span></td>
      <td class="l stc"><span class="stage s-${esc(r.stage)}">${esc(r.stage)}</span>${stepper(r)}</td><td>${md(date8(r.first)) || DASH}</td><td class="nw">${rng(r.sbd) || DASH}</td>
      <td>${md(r.pymd) || DASH}</td><td class="lstc">${md(r.lst) || DASH}</td><td>${num(r.price)}</td><td>${has(r.total) ? won(r.total) : DASH}</td></tr>`;
    $("#t-ipo thead").innerHTML = "<tr><th class='l'>회사 <span class='u'>주관사</span></th><th class='l'>진행 단계</th><th>신고서 제출</th><th>청약일</th><th>납입일</th><th>상장 예정일</th><th>공모가<span class='u'>원</span></th><th>공모 규모</th></tr>";
    const none = ipoQ.trim() ? "검색 결과가 없습니다" : "선택한 단계의 회사가 없습니다";
    $("#t-ipo tbody").innerHTML = rows.map(tr).join("") || `<tr><td class="l" colspan="8">${none}</td></tr>`;
    $("#c-ipo").innerHTML = rows.map((r) => `<button class="card" data-c="${esc(r.c)}"><div class="top"><div><div class="nm">${esc(r.n)}${r.spac ? ' <span class="mk">스팩</span>' : ""}</div><div class="sub">${esc((r.lead || []).join(", "))}</div></div><span class="stage s-${esc(r.stage)}">${esc(r.stage)}</span></div>
      ${stepper(r)}
      <div class="metrics">${[["청약", rng(r.sbd) || "–"], ["상장 예정", md(r.lst) || "–"], ["공모가", r.price ? fmt(r.price) : "–"], ["규모", has(r.total) ? won(r.total) : "–"]].map(([a, b]) => `<div class="metric"><span>${a}</span><b>${b}</b></div>`).join("")}</div></button>`).join("")
      || `<p class="note">${none}</p>`;
  }

  // 월간 캘린더: 주(週)마다 한 줄, 이어지는 일정은 한 막대로
  function renderCal(evs) {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $("#cal-title").textContent = `${y}년 ${m + 1}월`;
    const start = new Date(y, m, 1); start.setDate(1 - start.getDay());
    const last = new Date(y, m + 1, 0); const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay()));
    const todayKey = keyOf(new Date());
    const ORDER = { sub: 0, pay: 1, lst: 2 };
    let h = `<div class="cal-dow">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>`;
    for (const ws = new Date(start); ws <= end; ws.setDate(ws.getDate() + 7)) {
      const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(ws.getDate() + i); return d; });
      const k0 = keyOf(days[0]), k6 = keyOf(days[6]);
      // 이번 주에 걸친 일정 조각
      const segs = evs.filter(([a, b]) => a <= k6 && b >= k0).map(([a, b, t, r]) => {
        const s = a < k0 ? 0 : days.findIndex((d) => keyOf(d) === a);
        const e = b > k6 ? 6 : days.findIndex((d) => keyOf(d) === b);
        return { s, e, t, r, cl: a < k0, cr: b > k6 };
      }).filter((g) => g.s >= 0 && g.e >= g.s)
        .sort((p, q) => p.s - q.s || (q.e - q.s) - (p.e - p.s) || ORDER[p.t] - ORDER[q.t]);
      const lanes = [];
      segs.forEach((g) => { let i = lanes.findIndex((endCol) => endCol < g.s); if (i < 0) { i = lanes.length; lanes.push(-1); } lanes[i] = g.e; g.lane = i; });
      h += `<div class="wk" style="grid-template-rows:var(--dh)${lanes.length ? ` repeat(${lanes.length}, var(--lh))` : ""} minmax(6px, 1fr)">`;
      days.forEach((d, i) => {
        const k = keyOf(d), out = d.getMonth() !== m;
        h += `<div class="cell${out ? " out" : ""}${k === todayKey ? " today" : ""}${d.getDay() === 0 ? " sun" : ""}" style="grid-column:${i + 1}"><span class="d">${d.getDate()}</span></div>`;
      });
      segs.forEach((g) => {
        const lab = g.t === "sub" ? esc(g.r.n) : `<span class="pre">${EVL[g.t]} · </span>${esc(g.r.n)}`;
        h += `<button class="bar ${g.t}${g.cl ? " cl" : ""}${g.cr ? " cr" : ""}" data-c="${esc(g.r.c)}" style="grid-column:${g.s + 1} / ${g.e + 2};grid-row:${g.lane + 2}" title="${esc(g.r.n)} ${EVL[g.t]}">${lab}</button>`;
      });
      h += "</div>";
    }
    $("#cal").innerHTML = h;
  }
  $("#stages").addEventListener("click", (e) => { const s = e.target.closest("button")?.dataset.s; if (!s) return; stageSel.has(s) ? stageSel.delete(s) : stageSel.add(s); renderIpo(); });
  $("#q-ipo").addEventListener("input", (e) => { ipoQ = e.target.value; renderIpo(); });
  $("#f-spac").addEventListener("click", () => { showSpac = !showSpac; store.set("spac", showSpac ? "on" : "off"); renderIpo(); });
  $("#cal-prev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderIpo(); });
  $("#cal-next").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderIpo(); });
  const ipoClick = (e) => { const c = e.target.closest("[data-c]")?.dataset.c; if (c) openIpo(c); };
  ["#t-ipo tbody", "#c-ipo", "#cal", "#upcoming"].forEach((s) => $(s).addEventListener("click", ipoClick));

  function openIpo(c) {
    const r = IPO.find((x) => x.c === c); if (!r) return;
    const reps = (r.reports || []).map((x) => `<li><span class="when">${date8(x[0])}</span><span>${esc(x[1])}</span><a href="${dartLink(x[2])}" target="_blank" rel="noopener">원문 ↗</a></li>`).join("");
    const tile = (t, v, s) => `<div class="kpi"><span class="t">${t}</span><b>${v || "–"}</b><span class="s">${s || ""}</span></div>`;
    const links = (r.rc ? `<a href="${dartLink(r.rc)}" target="_blank" rel="noopener">최근 공시 ↗</a>` : "") + contactLinks(r);
    openSheet(`
      <div class="sh-head"><p class="eyebrow">공모 진행 · ${esc(r.stage)}</p><h2>${esc(r.n)}${r.spac ? ' <span class="mk">스팩</span>' : ""}</h2><div class="sub">${esc((r.lead || []).join(", "))}</div>
        ${links ? `<div class="sh-links">${links}</div>` : ""}</div>
      <div class="sh-body">
        <div class="panel steps-panel">${stepper(r, true)}${r.stage === "철회" ? '<p class="note">이 공모는 철회되었습니다.</p>' : ""}</div>
        <div class="sh-kpis">${tile("공모가", r.price ? `${fmt(r.price)}원` : "", "모집(매출)가액")}${tile("공모 규모", won(r.total), "모집(매출)총액")}</div>
        ${sec("01", "일정", kv([["단계", `<span class="stage s-${esc(r.stage)}">${esc(r.stage)}</span>`], ["신고서 제출", date8(r.first)], ["청약일", (r.sbd || []).join(" ~ ")], ["납입일", r.pymd || ""], ["상장 예정일", r.lst || "원문 확인"]]))}
        <p class="note">상장 예정일은 투자설명서(없으면 증권신고서) 원문에서 자동으로 읽은 값입니다. 수요예측 일정·확정 공모가는 원문에서 확인하세요.</p>
        ${sec("02", "회사 정보", kv([["대표", esc(r.ceo)], ["종목코드", esc(r.s)], ...contactKv(r)]))}
        ${sec("03", "관련 공시", reps ? `<div class="panel"><ul class="timeline">${reps}</ul></div>` : '<p class="note">없음</p>')}
      </div>`);
  }

  // ── 불러오기 ──
  Promise.all(["listed", "ipo", "meta"].map((n) => fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : n === "meta" ? {} : []))))
    .then(([l, i, m]) => {
      LISTED = l; IPO = i; META = m;
      $("#tab-n-listed").textContent = fmt(LISTED.length);
      $("#tab-n-ipo").textContent = fmt(IPO.filter((r) => !["상장", "철회"].includes(r.stage)).length);
      const prog = META.listed && META.detail_done < META.listed ? ` · 상세 수집 ${fmt(META.detail_done)}/${fmt(META.listed)}` : "";
      const capTxt = META.cap_date ? ` · 시총 ${date8(META.cap_date)} 종가` : "";
      $("#meta").textContent = META.updated ? `${META.updated} 갱신 · 재무 ${META.fy} 사업보고서 기준${capTxt}${prog}` : "아직 수집 전입니다";
      if (META.cap_date) $("#cap-src").textContent = `· 시총 ${date8(META.cap_date)} 종가 기준`;
      syncChips(); renderListed(); renderIpo();
      const t = (location.hash || "").slice(1) || store.get("tab") || "listed";
      showTab(t === "ipo" ? "ipo" : "listed");
    })
    .catch(() => { $("#meta").textContent = "데이터를 불러오지 못했습니다"; });
})();
