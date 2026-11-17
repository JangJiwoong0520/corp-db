"use strict";
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v, d = 0) => (v === undefined || v === null || v === "" ? "" : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const numCell = (v, d = 0) => (v === undefined || v === null ? "" : `<span class="${v < 0 ? "neg" : ""}">${fmt(v, d)}</span>`);
  const date8 = (s) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s || "");
  const MARKET = { Y: "코스피", K: "코스닥", N: "코넥스" };
  const EVN = { CB: "CB", BW: "BW", EB: "EB", RI: "유상증자", TQ: "자사주 취득" };
  const dartLink = (rc) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rc)}`;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

  let LISTED = [], IPO = [], META = {};

  // ── 탭 ──
  function showTab(name) {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    $("#tab-listed").hidden = name !== "listed";
    $("#tab-ipo").hidden = name !== "ipo";
    store.set("tab", name);
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  }
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ── 상장사 표 ──
  const COLS = [
    { k: "n", t: "회사", cls: "name", v: (r) => r.n, h: (r) => `${esc(r.n)}<span class="mk">${MARKET[r.m] || ""}</span>` },
    { k: "ind", t: "업종", cls: "l", v: (r) => r.ind || "", h: (r) => esc((r.ind || "").slice(0, 16)) },
    { k: "age", t: "대표 나이", v: (r) => r.age, h: (r) => fmt(r.age) },
    { k: "rev", t: "매출", v: (r) => r.rev, h: (r) => numCell(r.rev) },
    { k: "op", t: "영업이익", v: (r) => r.op, h: (r) => numCell(r.op) },
    { k: "opm", t: "영업이익률%", v: (r) => r.opm, h: (r) => numCell(r.opm, 1) },
    { k: "cash", t: "현금성자산", v: (r) => r.cash, h: (r) => numCell(r.cash) },
    { k: "dr", t: "부채비율%", v: (r) => r.dr, h: (r) => numCell(r.dr) },
    { k: "mhr", t: "최대주주+특관%", v: (r) => r.mhr, h: (r) => numCell(r.mhr, 1) },
    { k: "tsr", t: "자사주%", v: (r) => r.tsr, h: (r) => numCell(r.tsr, 1) },
    { k: "mz", t: "메자닌 3년", v: (r) => (r.mz ? r.mz[0] : null), h: (r) => evCell(r.mz) },
    { k: "ri", t: "유상증자 3년", v: (r) => (r.ri ? r.ri[0] : null), h: (r) => evCell(r.ri) },
    { k: "tq", t: "자사주취득 1년", v: (r) => (r.tq ? r.tq[0] : null), h: (r) => evCell(r.tq) },
    { k: "bond", t: "회사채 잔액", v: (r) => r.bond, h: (r) => numCell(r.bond) },
    { k: "emp", t: "직원 수", v: (r) => r.emp, h: (r) => numCell(r.emp) },
  ];
  function evCell(e) {
    if (!e) return "";
    return `${e[0]}건${e[1] ? ` · ${fmt(e[1])}억` : ""}`;
  }

  let sortKey = store.get("sort") || "rev", sortAsc = store.get("asc") === "1", page = 1;
  const PER = 50;

  function filtered() {
    const q = $("#q").value.trim().toLowerCase();
    const mk = $("#f-market").value;
    const minRev = parseFloat($("#f-rev").value), minCash = parseFloat($("#f-cash").value);
    const need = (id) => $(id).checked;
    return LISTED.filter((r) => {
      if (q && ![r.n, r.s, r.ind, r.ceo, r.mh].some((x) => String(x || "").toLowerCase().includes(q))) return false;
      if (mk && r.m !== mk) return false;
      if (!isNaN(minRev) && !(r.rev >= minRev)) return false;
      if (!isNaN(minCash) && !(r.cash >= minCash)) return false;
      if (need("#f-mz") && !r.mz) return false;
      if (need("#f-ri") && !r.ri) return false;
      if (need("#f-tq") && !r.tq) return false;
      if (need("#f-age") && !(r.age >= 60)) return false;
      if (need("#f-bond") && !(r.bond > 0)) return false;
      if (need("#f-chg") && !(r.chg > 0)) return false;
      return true;
    });
  }

  function renderListed() {
    const col = COLS.find((c) => c.k === sortKey) || COLS[3];
    const rows = filtered().sort((a, b) => {
      const x = col.v(a), y = col.v(b);
      const ex = x === undefined || x === null || x === "", ey = y === undefined || y === null || y === "";
      if (ex && ey) return 0; if (ex) return 1; if (ey) return -1;
      const c = typeof x === "string" ? x.localeCompare(y, "ko") : x - y;
      return sortAsc ? c : -c;
    });
    const pages = Math.max(1, Math.ceil(rows.length / PER));
    page = Math.min(page, pages);
    $("#count").textContent = `${rows.length.toLocaleString()}곳 · 표를 누르면 상세 · 머리글을 누르면 정렬`;
    $("#t-listed thead").innerHTML = "<tr>" + COLS.map((c) => `<th class="${c.cls || ""} ${c.k === sortKey ? "sorted" + (sortAsc ? " asc" : "") : ""}" data-k="${c.k}">${c.t}</th>`).join("") + "</tr>";
    $("#t-listed tbody").innerHTML = rows.slice((page - 1) * PER, page * PER)
      .map((r) => `<tr data-c="${esc(r.c)}">` + COLS.map((c) => `<td class="${c.cls || ""}">${c.h(r)}</td>`).join("") + "</tr>").join("");
    const btn = (p, label = p) => `<button class="ghost" data-p="${p}" ${p === page ? 'aria-current="true"' : ""}>${label}</button>`;
    let pg = "";
    if (pages > 1) {
      const lo = Math.max(1, page - 3), hi = Math.min(pages, page + 3);
      if (lo > 1) pg += btn(1, "«");
      for (let p = lo; p <= hi; p++) pg += btn(p);
      if (hi < pages) pg += btn(pages, "»");
    }
    $("#pager").innerHTML = pg;
  }

  $("#t-listed thead").addEventListener("click", (e) => {
    const k = e.target.closest("th")?.dataset.k; if (!k) return;
    if (k === sortKey) sortAsc = !sortAsc; else { sortKey = k; sortAsc = k === "n" || k === "ind"; }
    store.set("sort", sortKey); store.set("asc", sortAsc ? "1" : "0");
    renderListed();
  });
  $("#pager").addEventListener("click", (e) => { const p = e.target.dataset.p; if (p) { page = +p; renderListed(); window.scrollTo({ top: 0 }); } });
  $("#t-listed tbody").addEventListener("click", (e) => { const c = e.target.closest("tr")?.dataset.c; if (c) openCompany(c); });
  ["#q", "#f-market", "#f-rev", "#f-cash", "#f-mz", "#f-ri", "#f-tq", "#f-age", "#f-bond", "#f-chg"].forEach((id) =>
    $(id).addEventListener("input", () => { page = 1; renderListed(); }));
  $("#f-reset").addEventListener("click", () => {
    $("#q").value = ""; $("#f-market").value = ""; $("#f-rev").value = ""; $("#f-cash").value = "";
    document.querySelectorAll(".filters input[type=checkbox]").forEach((x) => (x.checked = false));
    page = 1; renderListed();
  });

  // ── 상세 ──
  function kv(pairs) {
    return '<dl class="kv">' + pairs.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") + "</dl>";
  }
  function openSheet(html) { $("#sheet-content").innerHTML = html; $("#sheet").hidden = false; }
  $("#sheet-close").addEventListener("click", () => ($("#sheet").hidden = true));
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") $("#sheet").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#sheet").hidden = true; });

  function openCompany(c) {
    const r = LISTED.find((x) => x.c === c); if (!r) return;
    const u = (v, unit) => (v === undefined || v === null ? "" : `${fmt(v)}${unit}`);
    const ev = (r.evl || []).map((e) => `<li>${date8(e[0])} · ${EVN[e[1]] || e[1]}${e[3] ? ` · ${fmt(e[3])}억` : ""} · <a href="${dartLink(e[2])}" target="_blank" rel="noopener">원문</a></li>`).join("");
    openSheet(`
      <h2>${esc(r.n)} <span class="mk">${MARKET[r.m] || ""}</span></h2>
      <p class="links"><a href="https://finance.naver.com/item/main.naver?code=${encodeURIComponent(r.s)}" target="_blank" rel="noopener">시세 보기(네이버)</a>
      <a href="https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm=${encodeURIComponent(r.n)}" target="_blank" rel="noopener">DART 공시</a></p>
      <h3>기본</h3>${kv([["종목코드", esc(r.s)], ["업종", esc(r.ind)], ["대표", esc(r.ceo)], ["대표 나이", u(r.age, "세")], ["설립일", date8(r.est)], ["결산월", r.acc ? `${r.acc}월` : ""], ["지역", esc(r.reg)], ["감사인", esc(r.aud)], ["감사의견", esc(r.audop)]])}
      <h3>재무 (${r.fy || "-"} 사업보고서, 억원)</h3>${kv([["매출", u(r.rev, "")], ["영업이익", u(r.op, "")], ["영업이익률", r.opm != null ? `${fmt(r.opm, 1)}%` : ""], ["당기순이익", u(r.ni, "")], ["현금성자산", u(r.cash, "")], ["자산총계", u(r.ta, "")], ["부채총계", u(r.tl, "")], ["자본총계", u(r.te, "")], ["부채비율", r.dr != null ? `${fmt(r.dr)}%` : ""], ["회사채 미상환", u(r.bond, "")]])}
      <h3>주주</h3>${kv([["최대주주", esc(r.mh)], ["최대주주+특관 지분", r.mhr != null ? `${fmt(r.mhr, 2)}%` : ""], ["최대주주 변동", r.chg != null ? `${r.chg}건 (해당 사업연도)` : ""], ["발행주식수", u(r.sh, "주")], ["자기주식 비율", r.tsr != null ? `${fmt(r.tsr, 2)}%` : ""], ["현금배당성향", r.pay != null ? `${fmt(r.pay, 1)}%` : ""]])}
      <h3>임직원</h3>${kv([["직원 수", u(r.emp, "명")], ["1인 평균 급여", u(r.sal, "백만원")], ["평균 근속", r.ten != null ? `${fmt(r.ten, 1)}년` : ""]])}
      <h3>주요사항보고서 (최근 3년)</h3>${ev ? `<ul class="evlist">${ev}</ul>` : '<p class="note">없음</p>'}
    `);
  }

  // ── 공모 탭 ──
  const STAGES = ["증권신고서", "수요예측", "청약예정", "청약중", "납입·상장대기", "상장", "철회"];
  let stageSel = new Set(STAGES.filter((s) => s !== "철회"));
  let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();

  function renderIpo() {
    const counts = Object.fromEntries(STAGES.map((s) => [s, IPO.filter((r) => r.stage === s).length]));
    $("#stages").innerHTML = STAGES.map((s) => `<button data-s="${s}" aria-pressed="${stageSel.has(s)}">${s} ${counts[s]}</button>`).join("");
    const rows = IPO.filter((r) => stageSel.has(r.stage));
    $("#t-ipo thead").innerHTML = "<tr><th class='name'>회사</th><th class='l'>단계</th><th>신고서 제출</th><th>청약일</th><th>납입일</th><th>공모가(원)</th><th>공모규모(억)</th><th class='l'>주관사</th></tr>";
    $("#t-ipo tbody").innerHTML = rows.map((r) => `<tr data-c="${esc(r.c)}">
      <td class="name">${esc(r.n)}${r.spac ? ' <span class="mk">스팩</span>' : ""}</td><td class="l"><span class="tag">${esc(r.stage)}</span></td>
      <td>${date8(r.first)}</td><td>${(r.sbd || []).join(" ~ ")}</td><td>${r.pymd || ""}</td>
      <td>${fmt(r.price)}</td><td>${fmt(r.total)}</td><td class="l">${esc((r.lead || []).join(", "))}</td></tr>`).join("") ||
      `<tr><td class="l" colspan="8">해당 단계의 회사가 없습니다</td></tr>`;
    renderCal(rows);
  }
  function renderCal(rows) {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $("#cal-title").textContent = `${y}년 ${m + 1}월 일정`;
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const pad = (n) => String(n).padStart(2, "0");
    const evs = {};
    rows.forEach((r) => {
      const sbd = r.sbd || [];
      if (sbd.length) {
        let d = new Date(sbd[0]), end = new Date(sbd[sbd.length - 1]);
        for (let i = 0; d <= end && i < 10; i++, d.setDate(d.getDate() + 1)) {
          const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; (evs[k] ||= []).push(["청약", r]);
        }
      }
      if (r.pymd) (evs[r.pymd] ||= []).push(["납입", r]);
    });
    const now = new Date(), todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    let h = ["일", "월", "화", "수", "목", "금", "토"].map((d) => `<div class="dow">${d}</div>`).join("");
    for (let i = 0; i < first; i++) h += "<div></div>";
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${pad(m + 1)}-${pad(d)}`;
      h += `<div class="day ${k === todayKey ? "today" : ""}"><span class="d">${d}</span>` +
        (evs[k] || []).map(([t, r]) => `<span class="ev ${t === "납입" ? "pay" : ""}" data-c="${esc(r.c)}" title="${esc(r.n)} ${t}">${t === "납입" ? "납" : "청"} ${esc(r.n)}</span>`).join("") + "</div>";
    }
    $("#cal").innerHTML = h;
  }
  $("#stages").addEventListener("click", (e) => {
    const s = e.target.closest("button")?.dataset.s; if (!s) return;
    stageSel.has(s) ? stageSel.delete(s) : stageSel.add(s); renderIpo();
  });
  $("#cal-prev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderIpo(); });
  $("#cal-next").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderIpo(); });
  const ipoClick = (e) => { const c = e.target.closest("[data-c]")?.dataset.c; if (c) openIpo(c); };
  $("#t-ipo tbody").addEventListener("click", ipoClick);
  $("#cal").addEventListener("click", ipoClick);

  function openIpo(c) {
    const r = IPO.find((x) => x.c === c); if (!r) return;
    const reps = (r.reports || []).map((x) => `<li>${date8(x[0])} · ${esc(x[1])} · <a href="${dartLink(x[2])}" target="_blank" rel="noopener">원문</a></li>`).join("");
    openSheet(`<h2>${esc(r.n)}</h2>
      ${kv([["단계", `<span class="tag">${esc(r.stage)}</span>`], ["대표", esc(r.ceo)], ["신고서 제출", date8(r.first)], ["청약일", (r.sbd || []).join(" ~ ")], ["납입일", r.pymd || ""], ["공모가", r.price ? `${fmt(r.price)}원` : ""], ["공모 규모", r.total ? `${fmt(r.total)}억원` : ""], ["주관사", esc((r.lead || []).join(", "))], ["종목코드", esc(r.s)]])}
      <p class="note">수요예측 일정·확정 공모가·상장 예정일은 증권신고서/투자설명서 원문에서 확인하세요.</p>
      <h3>관련 공시</h3><ul class="evlist">${reps}</ul>`);
  }

  // ── 불러오기 ──
  Promise.all(["listed", "ipo", "meta"].map((n) => fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : n === "meta" ? {} : []))))
    .then(([l, i, m]) => {
      LISTED = l; IPO = i; META = m;
      const prog = META.listed ? ` · 상세 수집 ${fmt(META.detail_done)}/${fmt(META.listed)}` : "";
      $("#meta").textContent = META.updated ? `갱신 ${META.updated} · 재무 기준 ${META.fy} 사업보고서 · 상장사 ${fmt(META.listed)}곳${prog}` : "아직 수집 전입니다";
      renderListed(); renderIpo();
      const t = (location.hash || "").slice(1) || store.get("tab") || "listed";
      showTab(t === "ipo" ? "ipo" : "listed");
    })
    .catch(() => { $("#meta").textContent = "데이터를 불러오지 못했습니다"; });
})();
