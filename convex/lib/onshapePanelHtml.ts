// Markup for the Onshape right-panel app (part picker + preview), rendered by
// the `panel` httpAction in ../onshapeOAuth.ts.

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function panelHtml(
  parts: Array<{
    key: string;
    name: string;
    material: string | null;
    tracked: boolean;
    quantity: number;
    sameDocument: boolean;
  }>,
  token: string,
  wv: string,
): Response {
  const rows =
    parts.length === 0
      ? `<p class="muted">No parts found in this element.</p>`
      : parts
          .map((p) => {
            const meta = [
              p.quantity > 1 ? `×${p.quantity}` : null,
              p.material,
              p.tracked ? "tracked" : null,
              p.sameDocument ? null : "linked doc",
            ]
              .filter((m): m is string => Boolean(m))
              .map(esc)
              .join(" · ");
            return `<label class="row">
              <input type="checkbox" class="part" value="${esc(p.key)}" ${p.tracked ? "" : "checked"} />
              <span class="body"><span class="name">${esc(p.name)}</span>${meta ? `<span class="meta">${meta}</span>` : ""}</span>
            </label>`;
          })
          .join("");
  const versionNote =
    wv === "v"
      ? `<p class="note">Opened from a version — part numbers won't be written back to Onshape.</p>`
      : "";
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deceivers · Sync</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#001730;color:#EAF1F9;margin:0;padding:16px;font-size:14px}
  h1{font-size:15px;margin:0 0 4px}
  .sub{color:#8fa6c0;margin:0 0 12px;font-size:12px}
  .selectall{display:flex;align-items:center;gap:6px;color:#8fa6c0;font-size:12px;margin-bottom:8px}
  .list{border:1px solid #123253;border-radius:8px;overflow:hidden}
  .row{display:flex;align-items:center;gap:10px;padding:9px 11px;border-bottom:1px solid #0c2542;cursor:pointer}
  .row:last-child{border-bottom:none}
  .row:hover{background:#06213c}
  input[type=checkbox]{width:16px;height:16px;accent-color:#3b82f6;flex:none}
  .body{display:flex;flex-direction:column;min-width:0}
  .name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .meta{color:#8fa6c0;font-size:12px}
  .muted{color:#8fa6c0}
  .note{color:#f4c453;font-size:12px;margin:10px 0 0}
  button{margin-top:12px;width:100%;background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer}
  button.secondary{background:transparent;border:1px solid #123253;color:#EAF1F9}
  button:disabled{opacity:.5;cursor:default}
  .status{margin-top:10px;font-size:13px;min-height:18px}
  .hidden{display:none}
  .pcard{display:flex;gap:10px;padding:10px 11px;border-bottom:1px solid #0c2542;align-items:center}
  .pcard:last-child{border-bottom:none}
  .thumb,.noimg{width:56px;height:56px;border-radius:6px;border:1px solid #123253;background:#06213c;flex:none}
  .thumb{object-fit:contain}
  .noimg{display:flex;align-items:center;justify-content:center;color:#8fa6c0;font-size:10px;text-align:center;line-height:1.1}
  .pinfo{min-width:0}
  .ppn{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;margin-top:2px}
  .tag{font-size:11px;color:#8fa6c0}
  .wb{color:#6fd08c}
</style></head><body>
  <section id="pick">
    <h1>Sync to Deceivers tracker</h1>
    <p class="sub">Pick the parts to track, then preview before syncing.</p>
    <label class="selectall"><input type="checkbox" id="all" /> Select all</label>
    <div class="list">${rows}</div>
    ${versionNote}
    <button id="previewBtn"${parts.length === 0 ? " disabled" : ""}>Preview selected</button>
    <div id="pickStatus" class="status"></div>
  </section>
  <section id="preview" class="hidden">
    <h1>Review before syncing</h1>
    <p class="sub">This is a preview — nothing has been written yet.</p>
    <div class="list" id="previewList"></div>
    <button id="syncBtn">Sync to tracker</button>
    <button id="backBtn" class="secondary">Back</button>
    <div id="previewStatus" class="status"></div>
  </section>
<script>
  var token = ${JSON.stringify(token)};
  var wv = ${JSON.stringify(wv)};
  var selected = [];
  var pick = document.getElementById('pick');
  var preview = document.getElementById('preview');
  var previewList = document.getElementById('previewList');
  var pickStatus = document.getElementById('pickStatus');
  var previewStatus = document.getElementById('previewStatus');
  var boxes = function(){ return Array.prototype.slice.call(document.querySelectorAll('input.part')); };

  var allBox = document.getElementById('all');
  if (allBox) allBox.addEventListener('change', function(e){
    boxes().forEach(function(b){ b.checked = e.target.checked; });
  });

  function post(url, body){
    return fetch(url, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); });
  }

  function renderPreview(parts){
    previewList.textContent = '';
    parts.forEach(function(p){
      var card = document.createElement('div'); card.className = 'pcard';
      if (p.image){
        var img = document.createElement('img'); img.className = 'thumb'; img.src = p.image; img.alt = '';
        card.appendChild(img);
      } else {
        var ph = document.createElement('div'); ph.className = 'noimg'; ph.textContent = 'no preview';
        card.appendChild(ph);
      }
      var info = document.createElement('div'); info.className = 'pinfo';
      var name = document.createElement('div'); name.className = 'name'; name.textContent = p.name;
      var meta = document.createElement('div'); meta.className = 'meta';
      var bits = [];
      if (p.quantity > 1) bits.push('×' + p.quantity);
      if (p.material) bits.push(p.material);
      bits.push(p.tracked ? 'already tracked' : 'new');
      if (!p.sameDocument) bits.push('linked from another document — quantity only');
      meta.textContent = bits.join(' · ');
      var pn = document.createElement('div'); pn.className = 'ppn';
      pn.textContent = p.partNumber || 'no number (map this document first)';
      if (p.partNumber && p.willWriteBack && wv === 'w'){
        var wb = document.createElement('span'); wb.className = 'wb'; wb.textContent = '  → will write to Onshape';
        pn.appendChild(wb);
      }
      info.appendChild(name); info.appendChild(meta); info.appendChild(pn);
      card.appendChild(info);
      previewList.appendChild(card);
    });
  }

  document.getElementById('previewBtn').addEventListener('click', function(){
    var ids = boxes().filter(function(b){ return b.checked; }).map(function(b){ return b.value; });
    if(!ids.length){ pickStatus.textContent = 'Select at least one part.'; return; }
    var btn = document.getElementById('previewBtn');
    btn.disabled = true; pickStatus.textContent = 'Loading preview…';
    post('/onshape/preview-selected', { token: token, keys: ids }).then(function(res){
      btn.disabled = false;
      if(!res.ok){ pickStatus.textContent = '⚠️ ' + (res.d.error || 'Preview failed.'); return; }
      selected = ids; pickStatus.textContent = '';
      renderPreview(res.d.parts);
      pick.classList.add('hidden'); preview.classList.remove('hidden');
    }).catch(function(e){ btn.disabled = false; pickStatus.textContent = '⚠️ ' + e.message; });
  });

  document.getElementById('backBtn').addEventListener('click', function(){
    preview.classList.add('hidden'); pick.classList.remove('hidden');
    previewStatus.textContent = '';
  });

  document.getElementById('syncBtn').addEventListener('click', function(){
    var btn = document.getElementById('syncBtn');
    btn.disabled = true;
    document.getElementById('backBtn').disabled = true;
    previewStatus.textContent = 'Syncing…';
    post('/onshape/sync-selected', { token: token, keys: selected }).then(function(res){
      if(!res.ok){
        previewStatus.textContent = '⚠️ ' + (res.d.error || 'Sync failed.');
        btn.disabled = false; document.getElementById('backBtn').disabled = false; return;
      }
      previewStatus.textContent = '✅ Synced ' + res.d.upserted + ' part(s) · ' + res.d.numbersWritten + ' number(s) written · ' + res.d.previews + ' preview(s).';
    }).catch(function(e){
      previewStatus.textContent = '⚠️ ' + e.message;
      btn.disabled = false; document.getElementById('backBtn').disabled = false;
    });
  });
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
