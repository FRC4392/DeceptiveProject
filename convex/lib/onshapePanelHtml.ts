// Markup for the Onshape right-panel app (the part picker), rendered by the
// `panel` httpAction in ../onshapeOAuth.ts. Picking parts sends them to the
// tracker's "New from Onshape" queue; nothing is written back into Onshape.

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
              p.sameDocument ? null : "linked doc — quantity only",
            ]
              .filter((m): m is string => Boolean(m))
              .map(esc)
              .join(" · ");
            return `<label class="row">
              <input type="checkbox" class="part" value="${esc(p.key)}" checked />
              <span class="body"><span class="name">${esc(p.name)}</span>${meta ? `<span class="meta">${meta}</span>` : ""}</span>
            </label>`;
          })
          .join("");
  const versionNote =
    wv === "v"
      ? `<p class="note">Opened from a version — that's what gets recorded.</p>`
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
  input[type=checkbox]{width:16px;height:16px;accent-color:#2E6DBE;flex:none}
  .body{display:flex;flex-direction:column;min-width:0}
  .name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .meta{color:#8fa6c0;font-size:12px}
  .muted{color:#8fa6c0}
  .note{color:#f4c453;font-size:12px;margin:10px 0 0}
  button{margin-top:12px;width:100%;background:#2E6DBE;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .status{margin-top:10px;font-size:13px;min-height:18px}
</style></head><body>
  <section id="pick">
    <h1>Send to the Deceivers tracker</h1>
    <p class="sub">Pick the parts. A design lead reviews them under "New from Onshape".</p>
    <label class="selectall"><input type="checkbox" id="all" /> Select all</label>
    <div class="list">${rows}</div>
    ${versionNote}
    <button id="syncBtn"${parts.length === 0 ? " disabled" : ""}>Send selected</button>
    <div id="pickStatus" class="status"></div>
  </section>
<script>
  var token = ${JSON.stringify(token)};
  var pickStatus = document.getElementById('pickStatus');
  var boxes = function(){ return Array.prototype.slice.call(document.querySelectorAll('input.part')); };

  var allBox = document.getElementById('all');
  if (allBox) allBox.addEventListener('change', function(e){
    boxes().forEach(function(b){ b.checked = e.target.checked; });
  });

  document.getElementById('syncBtn').addEventListener('click', function(){
    var ids = boxes().filter(function(b){ return b.checked; }).map(function(b){ return b.value; });
    if(!ids.length){ pickStatus.textContent = 'Select at least one part.'; return; }
    var btn = document.getElementById('syncBtn');
    btn.disabled = true; pickStatus.textContent = 'Sending…';
    fetch('/onshape/sync-selected', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, keys: ids })
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(res){
        if(!res.ok){
          pickStatus.textContent = '⚠️ ' + (res.d.error || 'Send failed.');
          btn.disabled = false; return;
        }
        pickStatus.textContent = '✅ Sent ' + res.d.found + ' part(s). Review them in the tracker.';
      }).catch(function(e){ pickStatus.textContent = '⚠️ ' + e.message; btn.disabled = false; });
  });
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
