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
  const F = { q: "", market: "", flags: new Set(), rev: NaN, cash: NaN };
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
    F.q = ""; F.market = ""; F.flags.clear(); F.rev = NaN; F.cash = NaN;
    $("#q").value = ""; $("#f-rev").value = ""; $("#f-cash").value = "";
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
  $("#f-reset").addEventListener("click", resetFilters);

  function filtered() {
    return LISTED.filter((r) => {
      if (F.q && ![r.n, r.s, r.ind, r.ceo, r.mh].some((x) => String(x || "").toLowerCase().includes(F.q))) return false;
      if (F.market && r.m !== F.market) return false;
      if (!isNaN(F.rev) && !(r.rev >= F.rev)) return false;
      if (!isNaN(F.cash) && !(r.cash >= F.cash)) return false;
      for (const f of F.flags) if (!FLAG[f](r)) return false;
      return true;
    });
  }

  // ── 상장사: 표·카드 ──
  const SORTV = {
    n: (r) => r.n, rev: (r) => r.rev, op: (r) => r.op, cash: (r) => r.cash, dr: (r) => r.dr, mhr: (r) => r.mhr,
    tsr: (r) => r.tsr, age: (r) => r.age, bond: (r) => r.bond, mz: (r) => (r.mz ? r.mz[0] : null),
  };
  const COLS = [
    { k: "n", t: "회사", cls: "l co" },
    { k: "rev", t: "매출", u: "억원" },
    { k: "op", t: "영업이익", u: "억원 · 이익률" },
    { k: "cash", t: "현금성자산", u: "억원" },
    { k: "dr", t: "부채비율", u: "%" },
    { k: "mhr", t: "최대주주+특관", u: "%", cls: "l" },
    { k: "tsr", t: "자사주", u: "%" },
    { k: "mz", t: "자금조달·주주환원", cls: "l", u: "건·금액" },
    { k: "bond", t: "회사채 잔액", u: "억원" },
  ];
  let sortKey = store.get("sort2") || "rev", sortAsc = store.get("asc2") === "1", page = 1;
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
      <div class="metrics">${m("매출", has(r.rev) ? won(r.rev) : "–")}${m("영업이익", has(r.op) ? won(r.op) : "–")}${m("현금성자산", has(r.cash) ? won(r.cash) : "–")}${m("최대주주", has(r.mhr) ? fmt(r.mhr, 1) + "%" : "–")}</div>
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
  const DEFAULT_SORT = "rev";
  function setSort(k, toggle) {
    const firstAsc = k === "n";
    if (toggle && k === sortKey && k !== DEFAULT_SORT) {
      // 같은 머리글을 다시 누르면: 처음 방향 → 반대 방향 → 기본 정렬(매출 큰 순)
      if (sortAsc === firstAsc) sortAsc = !firstAsc; else { sortKey = DEFAULT_SORT; sortAsc = false; }
    } else if (toggle && k === sortKey) {
      sortAsc = !sortAsc;
    } else { sortKey = k; sortAsc = firstAsc; }
    if ([...$("#sort").options].some((o) => o.value === sortKey)) $("#sort").value = sortKey;
    store.set("sort2", sortKey); store.set("asc2", sortAsc ? "1" : "0");
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
        ${r.lr ? `<a href="${dartLink(r.lr[2])}" target="_blank" rel="noopener">최근 정기보고서 ↗</a>` : ""}</div></div>
      <div class="sh-body">
        <div class="sh-kpis">${tile("매출", won(r.rev), esc(r.fyl || (r.fy ? `${r.fy} 사업보고서` : "")))}${tile("영업이익", won(r.op), has(r.opm) ? `이익률 ${fmt(r.opm, 1)}%` : "")}${tile("현금성자산", won(r.cash), "연결 우선")}${tile("최대주주+특관", pct(r.mhr), esc(r.mh || ""))}</div>
        ${sec("01", "기본 정보", kv([["대표", esc(r.ceo)], ["대표 나이", has(r.age) ? `${r.age}세` : ""], ["업종", esc(r.ind)], ["지역", esc(r.reg)], ["설립일", date8(r.est)], ["결산월", r.acc ? `${r.acc}월` : ""], ["감사인", esc(r.aud)], ["감사의견", esc(r.audop)]]))}
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
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];

  function ipoEvents(rows) {
    const evs = [];
    rows.forEach((r) => {
      const s = r.sbd || [];
      if (s.length) {
        const d = new Date(s[0]), end = new Date(s[s.length - 1]);
        for (let i = 0; d <= end && i < 10; i++, d.setDate(d.getDate() + 1)) evs.push([keyOf(d), "sub", r]);
      }
      if (r.pymd) evs.push([r.pymd, "pay", r]);
    });
    return evs;
  }
  function renderIpo() {
    const counts = Object.fromEntries(STAGES.map((s) => [s, IPO.filter((r) => r.stage === s).length]));
    $("#stages").innerHTML = STAGES.map((s, i) => `<li><button data-s="${s}" aria-pressed="${stageSel.has(s)}"><span class="step">STEP ${pad(i + 1)}</span><span class="lab">${s}</span><b>${counts[s]}</b></button></li>`).join("");
    const rows = IPO.filter((r) => stageSel.has(r.stage));
    const evs = ipoEvents(rows);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const until = new Date(today); until.setDate(until.getDate() + 14);
    const seen = new Set();
    const up = evs.filter(([k, t, r]) => { const d = new Date(k); const id = t + r.c; if (d < today || d > until || seen.has(id)) return false; seen.add(id); return true; })
      .sort((a, b) => a[0].localeCompare(b[0]));
    $("#upcoming").innerHTML = up.map(([k, t, r]) => { const d = new Date(k);
      return `<li data-c="${esc(r.c)}"><span class="d">${k.slice(5).replace("-", ".")}<small>${DOW[d.getDay()]}</small></span><span class="tagx ${t}">${t === "sub" ? "청약" : "납입"}</span><span class="n">${esc(r.n)}</span><span class="x">${r.price ? fmt(r.price) + "원" : ""}${r.total ? " · " + won(r.total) : ""}</span></li>`; }).join("")
      || '<li><span class="empty">앞으로 14일 안에 청약·납입 일정이 없습니다</span></li>';

    renderCal(evs);
    const tr = (r) => `<tr data-c="${esc(r.c)}"><td class="l co"><span class="nm">${esc(r.n)}${r.spac ? ' <span class="mk">스팩</span>' : ""}</span><span class="sub">${esc((r.lead || []).join(", ")) || "&nbsp;"}</span></td>
      <td class="l"><span class="stage s-${esc(r.stage)}">${esc(r.stage)}</span></td><td>${date8(r.first)}</td><td>${(r.sbd || []).map((x) => x.slice(5)).join(" ~ ") || DASH}</td>
      <td>${r.pymd ? r.pymd.slice(5) : DASH}</td><td>${num(r.price)}</td><td>${has(r.total) ? won(r.total) : DASH}</td></tr>`;
    $("#t-ipo thead").innerHTML = "<tr><th class='l'>회사 <span class='u'>주관사</span></th><th class='l'>단계</th><th>신고서 제출</th><th>청약일</th><th>납입일</th><th>공모가<span class='u'>원</span></th><th>공모 규모</th></tr>";
    $("#t-ipo tbody").innerHTML = rows.map(tr).join("") || `<tr><td class="l" colspan="7">선택한 단계의 회사가 없습니다</td></tr>`;
    $("#c-ipo").innerHTML = rows.map((r) => `<button class="card" data-c="${esc(r.c)}"><div class="top"><div><div class="nm">${esc(r.n)}</div><div class="sub">${esc((r.lead || []).join(", "))}</div></div><span class="stage s-${esc(r.stage)}">${esc(r.stage)}</span></div>
      <div class="metrics">${[["청약", (r.sbd || []).map((x) => x.slice(5)).join("~") || "–"], ["납입", r.pymd ? r.pymd.slice(5) : "–"], ["공모가", r.price ? fmt(r.price) : "–"], ["규모", has(r.total) ? won(r.total) : "–"]].map(([a, b]) => `<div class="metric"><span>${a}</span><b>${b}</b></div>`).join("")}</div></button>`).join("")
      || '<p class="note">선택한 단계의 회사가 없습니다</p>';
  }
  function renderCal(evs) {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $("#cal-title").textContent = `${y}년 ${m + 1}월`;
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const by = {}; evs.forEach(([k, t, r]) => (by[k] ||= []).push([t, r]));
    const todayKey = keyOf(new Date());
    let h = DOW.map((d) => `<div class="dow">${d}</div>`).join("");
    for (let i = 0; i < first; i++) h += '<div class="blank"></div>';
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${pad(m + 1)}-${pad(d)}`;
      h += `<div class="day ${k === todayKey ? "today" : ""}"><span class="d">${d}</span>` +
        (by[k] || []).map(([t, r]) => `<span class="ev ${t}" data-c="${esc(r.c)}" title="${esc(r.n)} ${t === "sub" ? "청약" : "납입"}">${esc(r.n)}</span>`).join("") + "</div>";
    }
    const tail = (7 - ((first + days) % 7)) % 7;
    for (let i = 0; i < tail; i++) h += '<div class="blank"></div>';
    $("#cal").innerHTML = h;
  }
  $("#stages").addEventListener("click", (e) => { const s = e.target.closest("button")?.dataset.s; if (!s) return; stageSel.has(s) ? stageSel.delete(s) : stageSel.add(s); renderIpo(); });
  $("#cal-prev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderIpo(); });
  $("#cal-next").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderIpo(); });
  const ipoClick = (e) => { const c = e.target.closest("[data-c]")?.dataset.c; if (c) openIpo(c); };
  ["#t-ipo tbody", "#c-ipo", "#cal", "#upcoming"].forEach((s) => $(s).addEventListener("click", ipoClick));

  function openIpo(c) {
    const r = IPO.find((x) => x.c === c); if (!r) return;
    const reps = (r.reports || []).map((x) => `<li><span class="when">${date8(x[0])}</span><span>${esc(x[1])}</span><a href="${dartLink(x[2])}" target="_blank" rel="noopener">원문 ↗</a></li>`).join("");
    const tile = (t, v, s) => `<div class="kpi"><span class="t">${t}</span><b>${v || "–"}</b><span class="s">${s || ""}</span></div>`;
    openSheet(`
      <div class="sh-head"><p class="eyebrow">공모 진행 · ${esc(r.stage)}</p><h2>${esc(r.n)}</h2><div class="sub">${esc((r.lead || []).join(", "))}</div></div>
      <div class="sh-body">
        <div class="sh-kpis">${tile("공모가", r.price ? `${fmt(r.price)}원` : "", "모집(매출)가액")}${tile("공모 규모", won(r.total), "모집(매출)총액")}</div>
        ${sec("01", "일정", kv([["단계", `<span class="stage s-${esc(r.stage)}">${esc(r.stage)}</span>`], ["신고서 제출", date8(r.first)], ["청약일", (r.sbd || []).join(" ~ ")], ["납입일", r.pymd || ""], ["대표", esc(r.ceo)], ["종목코드", esc(r.s)]]))}
        <p class="note">수요예측 일정·확정 공모가·상장 예정일은 증권신고서/투자설명서 원문에서 확인하세요.</p>
        ${sec("02", "관련 공시", reps ? `<div class="panel"><ul class="timeline">${reps}</ul></div>` : '<p class="note">없음</p>')}
      </div>`);
  }

  // ── 불러오기 ──
  Promise.all(["listed", "ipo", "meta"].map((n) => fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : n === "meta" ? {} : []))))
    .then(([l, i, m]) => {
      LISTED = l; IPO = i; META = m;
      $("#tab-n-listed").textContent = fmt(LISTED.length);
      $("#tab-n-ipo").textContent = fmt(IPO.filter((r) => !["상장", "철회"].includes(r.stage)).length);
      const prog = META.listed && META.detail_done < META.listed ? ` · 상세 수집 ${fmt(META.detail_done)}/${fmt(META.listed)}` : "";
      $("#meta").textContent = META.updated ? `${META.updated} 갱신 · 재무 ${META.fy} 사업보고서 기준${prog}` : "아직 수집 전입니다";
      syncChips(); renderListed(); renderIpo();
      const t = (location.hash || "").slice(1) || store.get("tab") || "listed";
      showTab(t === "ipo" ? "ipo" : "listed");
    })
    .catch(() => { $("#meta").textContent = "데이터를 불러오지 못했습니다"; });
})();
