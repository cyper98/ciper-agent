(function () {
    'use strict';
    var VS = acquireVsCodeApi();

    var vS = document.getElementById('v-s');
    var vC = document.getElementById('v-c');
    var slEl = document.getElementById('sl');
    var ct = document.getElementById('ct');
    var mn = document.getElementById('mn');
    var sb = document.getElementById('sb');
    var si = document.getElementById('si');
    var msgs = document.getElementById('msgs');
    var imgb = document.getElementById('imgb');
    var attb = document.getElementById('attb');
    var ci = document.getElementById('ci');
    var sndb = document.getElementById('sndb');
    var stpb = document.getElementById('stpb');
    var NEED_CONTINUE_TAG = '<ciper:need_continue />';

    var streaming = false, curAi = null, typEl = null, rawBuf = '';
    var autoConvertInFlight = false, autoConvertBudget = 1;
    var atFiles = [], imgFiles = [], ops = [], curSid = '';

    function showV(name) {
        vS.classList.toggle('active', name === 's');
        vC.classList.toggle('active', name === 'c');
    }

    document.getElementById('back-btn').addEventListener('click', function () {
        showV('s'); VS.postMessage({ command: 'loadSessions' });
    });
    document.getElementById('new-s-btn').addEventListener('click', function () {
        VS.postMessage({ command: 'newSession' });
    });

    function renderSL(sessions, aSid) {
        if (!sessions || !sessions.length) { slEl.innerHTML = '<div class="no-s">No chats yet. Click "+ New Chat" to start.</div>'; return; }
        var h = '';
        for (var i = 0; i < sessions.length; i++) {
            var s = sessions[i];
            var isA = s.session === aSid;
            var nm = fmtSid(s.session), dt = fmtDt(s.last_active);
            var pv = s.first_message ? esc(s.first_message.slice(0, 70)) + (s.first_message.length > 70 ? '…' : '') : '';
            h += '<div class="sc' + (isA ? ' active' : '') + '" data-sid="' + esc(s.session) + '">'
                + '<div class="si"><div class="sn">' + esc(nm) + (isA ? ' ●' : '') + '</div>'
                + '<div class="sm">' + dt + ' · ' + s.count + ' msgs</div>'
                + (pv ? '<div class="sp">' + pv + '</div>' : '')
                + '</div>'
                + '<button class="sd" data-sid="' + esc(s.session) + '" title="Delete">🗑</button>'
                + '</div>';
        }
        slEl.innerHTML = h;
    }
    slEl.addEventListener('click', function (e) {
        var d = e.target.closest('.sd');
        if (d) { e.stopPropagation(); VS.postMessage({ command: 'deleteSession', sessionId: d.dataset.sid }); return; }
        var c = e.target.closest('.sc');
        if (c) { VS.postMessage({ command: 'switchSession', sessionId: c.dataset.sid }); }
    });

    document.getElementById('btn-mdl').addEventListener('click', function () { VS.postMessage({ command: 'switchModel' }); });
    document.getElementById('btn-exp').addEventListener('click', function () { VS.postMessage({ command: 'exportChat' }); });
    document.getElementById('btn-clr').addEventListener('click', function () { VS.postMessage({ command: 'clearHistory' }); });
    document.getElementById('btn-srch').addEventListener('click', function () {
        sb.classList.toggle('open');
        if (sb.classList.contains('open')) { si.focus(); }
    });
    document.getElementById('sg-btn').addEventListener('click', function () {
        if (si.value.trim()) { VS.postMessage({ command: 'searchHistory' }); }
    });
    document.getElementById('sc-btn').addEventListener('click', function () { sb.classList.remove('open'); });
    si.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { document.getElementById('sg-btn').click(); }
        if (e.key === 'Escape') { sb.classList.remove('open'); }
    });

    document.addEventListener('paste', function (e) {
        if (!vC.classList.contains('active')) { return; }
        var items = Array.from((e.clipboardData && e.clipboardData.items) || []);
        var hasImg = false;
        items.forEach(function (item) {
            if (item.type.startsWith('image/')) {
                hasImg = true;
                var file = item.getAsFile();
                if (!file) { return; }
                var fr = new FileReader();
                fr.onload = function (ev) { imgFiles.push(ev.target.result); renderIB(); };
                fr.readAsDataURL(file);
            }
        });
        if (hasImg) { e.preventDefault(); }
    });
    function renderIB() {
        if (!imgFiles.length) { imgb.classList.remove('open'); return; }
        imgb.classList.add('open');
        imgb.innerHTML = imgFiles.map(function (u, i) {
            return '<div class="iw" data-i="' + i + '"><img class="it" src="' + u + '"><button class="ir" data-i="' + i + '">✕</button></div>';
        }).join('');
    }
    imgb.addEventListener('click', function (e) {
        var b = e.target.closest('.ir');
        if (b) { imgFiles.splice(parseInt(b.dataset.i, 10), 1); renderIB(); }
    });

    document.getElementById('atb').addEventListener('click', function () { VS.postMessage({ command: 'attachFile' }); });
    function renderAB() {
        if (!atFiles.length) { attb.classList.remove('open'); return; }
        attb.classList.add('open');
        attb.innerHTML = atFiles.map(function (f, i) {
            return '<div class="ach">📄 ' + esc(f.name) + '<button class="acr" data-i="' + i + '">✕</button></div>';
        }).join('');
    }
    attb.addEventListener('click', function (e) {
        var b = e.target.closest('.acr');
        if (b) { atFiles.splice(parseInt(b.dataset.i, 10), 1); renderAB(); }
    });

    function exOps(raw) {
        var res = [], m;
        var r1 = /<ciper:write\s+path=(?:"([^"]+)"|'([^']+)')\s*>([\s\S]*?)<\/ciper:write>/g;
        var r2 = /```ciper:write\s+path=(?:"([^"]+)"|'([^']+)')\n([\s\S]*?)```/g;
        var r3 = /<ciper:delete\s+path=(?:"([^"]+)"|'([^']+)')\s*\/>/g;
        var r4 = /<ciper:patch\s+path=(?:"([^"]+)"|'([^']+)')\s*>([\s\S]*?)<\/ciper:patch>/g;

        while ((m = r1.exec(raw)) !== null) { res.push({ a: 'w', p: m[1] || m[2], c: m[3] }); }
        while ((m = r2.exec(raw)) !== null) { res.push({ a: 'w', p: m[1] || m[2], c: m[3] }); }
        while ((m = r3.exec(raw)) !== null) { res.push({ a: 'd', p: m[1] || m[2], c: '' }); }
        while ((m = r4.exec(raw)) !== null) {
            var body = m[3] || '';
            var pairRe = /<ciper:find>([\s\S]*?)<\/ciper:find>\s*<ciper:replace>([\s\S]*?)<\/ciper:replace>/g;
            var pm;
            var edits = [];
            while ((pm = pairRe.exec(body)) !== null) {
                edits.push({ f: normalizePatchChunk(pm[1]), c: normalizePatchChunk(pm[2]) });
            }
            if (edits.length) {
                res.push({ a: 'p', p: m[1] || m[2], edits: edits });
            }
        }
        return groupOpsByFile(res);
    }
    function groupOpsByFile(inputOps) {
        var out = [];
        var patchMap = {};
        var i;

        for (i = 0; i < inputOps.length; i++) {
            var op = inputOps[i];
            if (op.a !== 'p') {
                out.push(op);
                continue;
            }
            if (!patchMap[op.p]) {
                patchMap[op.p] = { a: 'p', p: op.p, edits: [] };
                out.push(patchMap[op.p]);
            }
            var srcEdits = op.edits || [];
            for (var j = 0; j < srcEdits.length; j++) {
                patchMap[op.p].edits.push(srcEdits[j]);
            }
        }

        return out;
    }
    function normalizePatchChunk(input) {
        var text = String(input || '').replace(/\r/g, '');
        var fenced = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
        if (fenced) { return fenced[1]; }
        return text;
    }
    function exReads(raw) {
        var res = [], m, r = /<ciper:read\s+path=(?:"([^"]+)"|'([^']+)')\s*\/>/g;
        while ((m = r.exec(raw)) !== null) { res.push(m[1] || m[2]); }
        return res;
    }
    function exSearches(raw) {
        var res = [], m, r = /<ciper:search\s+query=(?:"([^"]+)"|'([^']+)')\s*\/?>(?:<\/ciper:search>)?/g;
        while ((m = r.exec(raw)) !== null) { res.push((m[1] || m[2] || '').trim()); }
        return res.filter(Boolean);
    }

    function normalizePathCandidate(rawPath) {
        if (!rawPath) { return ''; }
        var p = String(rawPath).trim();
        p = p.replace(/^`+|`+$/g, '');
        p = p.replace(/^\/\s*/, '').replace(/\s*\/$/, '');
        p = p.replace(/\s*\/\s*/g, '/');
        p = p.replace(/^\.\//, '');
        if (!p || p.indexOf('://') >= 0) { return ''; }
        if (p.indexOf('/') < 0) { return ''; }
        if (!/^[A-Za-z0-9._\-/]+$/.test(p)) { return ''; }
        return p;
    }

    function findNearestPathHint(textBefore) {
        var tail = textBefore.slice(Math.max(0, textBefore.length - 800));
        var lines = tail.split('\n').slice(-10).reverse();

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) { continue; }

            var m1 = line.match(/^\/?\s*([A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)+)\s*\/?$/);
            if (m1) {
                var p1 = normalizePathCandidate(m1[1]);
                if (p1) { return p1; }
            }

            var m2 = line.match(/(?:file|path)\s*[:：]\s*`?([A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)+)`?/i);
            if (m2) {
                var p2 = normalizePathCandidate(m2[1]);
                if (p2) { return p2; }
            }

            var m3 = line.match(/`([A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)+)`/);
            if (m3) {
                var p3 = normalizePathCandidate(m3[1]);
                if (p3) { return p3; }
            }
        }

        return '';
    }

    function extractPathFromFenceBody(codeBody) {
        var lines = String(codeBody || '').split('\n');
        if (!lines.length) { return { path: '', code: codeBody }; }

        var first = String(lines[0] || '').trim();
        var path = '';

        var m1 = first.match(/^\/\/\s*([A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)+)\s*$/);
        var m2 = first.match(/^#\s*([A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)+)\s*$/);
        var m3 = first.match(/^\/\*\s*([A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)+)\s*\*\/$/);
        var m4 = first.match(/^(?:file|path)\s*[:：]\s*`?([A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)+)`?$/i);

        var candidate = (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]) || (m4 && m4[1]) || '';
        path = normalizePathCandidate(candidate);

        if (!path) {
            return { path: '', code: codeBody };
        }

        lines.shift();
        if (lines.length && !String(lines[0]).trim()) { lines.shift(); }
        return { path: path, code: lines.join('\n') };
    }

    function findPathHintAround(raw, start, end) {
        var before = findNearestPathHint(raw.slice(0, start));
        if (before) { return before; }
        var after = findNearestPathHint(raw.slice(end, Math.min(raw.length, end + 800)));
        if (after) { return after; }
        return '';
    }

    function exImplicitWriteOps(raw) {
        var opsOut = [], ranges = [];
        var re = /```([\w+-]*)\n([\s\S]*?)```/g;
        var m;
        while ((m = re.exec(raw)) !== null) {
            var full = m[0];
            var lang = m[1] || '';
            var code = m[2] || '';
            if (String(lang).toLowerCase().indexOf('ciper:') === 0) { continue; }
            if (!code.trim()) { continue; }

            var parsedFence = extractPathFromFenceBody(code);
            var fencePath = parsedFence.path;
            var fenceCode = parsedFence.code;
            if (!fenceCode.trim()) { continue; }

            var start = m.index;
            var end = start + full.length;
            var guessedPath = fencePath || findPathHintAround(raw, start, end);
            if (!guessedPath) { continue; }

            opsOut.push({ a: 'w', p: guessedPath, c: fenceCode.replace(/\n+$/, '') });
            ranges.push([start, end]);
        }
        return { ops: opsOut, ranges: ranges };
    }

    function removeRanges(text, ranges) {
        if (!ranges.length) { return text; }
        var out = '';
        var cursor = 0;
        for (var i = 0; i < ranges.length; i++) {
            var r = ranges[i];
            out += text.slice(cursor, r[0]);
            cursor = r[1];
        }
        out += text.slice(cursor);
        return out;
    }

    function stripTags(raw) {
        return raw
            .replace(/<ciper:write\s+path=(?:"[^"]+"|'[^']+')\s*>[\s\S]*?<\/ciper:write>/g, '')
            .replace(/```ciper:write\s+path=(?:"[^"]+"|'[^']+')\n[\s\S]*?```/g, '')
            .replace(/<ciper:delete\s+path=(?:"[^"]+"|'[^']+')\s*\/>/g, '')
            .replace(/<ciper:read\s+path=(?:"[^"]+"|'[^']+')\s*\/>/g, '')
            .replace(/<ciper:search\s+query=(?:"[^"]+"|'[^']+')\s*\/?>(?:<\/ciper:search>)?/g, '')
            .replace(/<ciper:patch\s+path=(?:"[^"]+"|'[^']+')\s*>[\s\S]*?<\/ciper:patch>/g, '')
            .replace(new RegExp(NEED_CONTINUE_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
    }
    function mkOpCard(op, idx) {
        var sp = esc(op.p);
        if (op.a === 'w') {
            var snip = esc(op.c.length > 800 ? op.c.slice(0, 800) + '\n…' : op.c);
            return '<div class="foc" data-oi="' + idx + '"><div class="foh"><span>📝</span><span class="fop">' + sp + '</span>'
                + '<span class="fob cr">edit</span></div>'
                + '<div class="fopre"><code>' + snip + '</code></div>'
                + '<div class="foa"><button class="foa-ok">✓ Apply</button>'
                + '<button class="foa-df">⊞ Diff</button>'
                + '<button class="foa-no">✗ Reject</button></div></div>';
        }
        if (op.a === 'p') {
            var edits = op.edits || [];
            var blocks = edits.slice(0, 3).map(function (ed, i) {
                var fs = esc(ed.f.length > 220 ? ed.f.slice(0, 220) + '\n…' : ed.f);
                var rs = esc(ed.c.length > 220 ? ed.c.slice(0, 220) + '\n…' : ed.c);
                return 'Edit ' + (i + 1) + ':\nFIND:\n' + fs + '\n\nREPLACE:\n' + rs;
            }).join('\n\n----------------\n\n');
            var more = edits.length > 3 ? ('\n\n… +' + (edits.length - 3) + ' edits') : '';
            return '<div class="foc" data-oi="' + idx + '"><div class="foh"><span>✂</span><span class="fop">' + sp + '</span>'
                + '<span class="fob cr">patch</span></div>'
                + '<div class="fopre"><code>' + blocks + more + '</code></div>'
                + '<div class="foa"><button class="foa-ok">✓ Apply</button>'
                + '<button class="foa-df">⊞ Diff</button>'
                + '<button class="foa-no">✗ Reject</button></div></div>';
        }
        return '<div class="foc" data-oi="' + idx + '"><div class="foh"><span>🗑</span><span class="fop">' + sp + '</span>'
            + '<span class="fob dl">delete</span></div>'
            + '<div class="foa"><button class="foa-ok">✓ Delete</button>'
            + '<button class="foa-no">✗ Cancel</button></div></div>';
    }
    function mkReadCard(paths) {
        var d = document.createElement('div');
        d.className = 'frc'; d.dataset.paths = JSON.stringify(paths);
        d.innerHTML = '<h4>🔍 Ciper wants to read:</h4>'
            + '<ul>' + paths.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
            + '<div class="frca"><button class="frc-ok">✓ Allow</button>'
            + '<button class="frc-no">✗ Deny</button></div>';
        return d;
    }
    function mkSearchCard(query) {
        var d = document.createElement('div');
        d.className = 'frc fsc';
        d.dataset.query = query;
        d.innerHTML = '<h4>🔎 Ciper wants to search:</h4>'
            + '<ul><li>' + esc(query) + '</li></ul>'
            + '<div class="frca"><button class="fsc-ok">✓ Allow Search</button>'
            + '<button class="fsc-no">✗ Deny</button></div>';
        return d;
    }

    msgs.addEventListener('click', function (e) {
        var t = e.target;
        if (t.classList.contains('cpb')) {
            var code = t.nextElementSibling ? t.nextElementSibling.textContent : '';
            navigator.clipboard.writeText(code).then(function () { t.textContent = 'Copied!'; setTimeout(function () { t.textContent = 'Copy'; }, 1500); });
            return;
        }
        var fc = t.closest('.foc');
        if (fc) {
            var idx = parseInt(fc.dataset.oi, 10), op = ops[idx];
            if (!op) { return; }
            if (t.classList.contains('foa-ok')) {
                t.disabled = true; t.textContent = '…';
                VS.postMessage({
                    command: 'applyFileOp',
                    action: op.a === 'w' ? 'write' : (op.a === 'p' ? 'patch' : 'delete'),
                    filePath: op.p,
                    content: op.c,
                    findText: op.f || '',
                    edits: op.edits || []
                });
            }
            else if (t.classList.contains('foa-df')) {
                VS.postMessage({
                    command: 'previewFileOp',
                    action: op.a === 'w' ? 'write' : (op.a === 'p' ? 'patch' : 'delete'),
                    filePath: op.p,
                    content: op.c,
                    findText: op.f || '',
                    edits: op.edits || []
                });
            }
            else if (t.classList.contains('foa-no')) { fc.innerHTML = '<div class="for">✗ ' + esc(op.p) + '</div>'; }
            return;
        }
        var sc = t.closest('.fsc');
        if (sc) {
            if (t.classList.contains('fsc-ok')) {
                var query = sc.dataset.query || '';
                sc.innerHTML = '<div style="padding:6px;font-size:11px;color:var(--vscode-descriptionForeground)">🔎 Searching…</div>';
                VS.postMessage({ command: 'searchFiles', query: query });
            } else if (t.classList.contains('fsc-no')) { sc.remove(); }
            return;
        }
        var rc = t.closest('.frc');
        if (rc) {
            if (t.classList.contains('frc-ok')) {
                var paths = JSON.parse(rc.dataset.paths || '[]');
                rc.innerHTML = '<div style="padding:6px;font-size:11px;color:var(--vscode-descriptionForeground)">📖 Reading…</div>';
                VS.postMessage({ command: 'readFiles', paths: paths });
            } else if (t.classList.contains('frc-no')) { rc.remove(); }
            return;
        }
        if (t.classList.contains('cnb')) {
            t.remove();
            if (!streaming) { VS.postMessage({ command: 'continueResponse' }); }
            return;
        }
    });

    function mdRender(raw) {
        var h = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        h = h.replace(/```(\w*)?\n([\s\S]*?)```/g, function (_, l, c) {
            return '<pre><button class="cpb">Copy</button><code class="lang-' + (l || '') + '">' + c + '</code></pre>';
        });
        h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        h = h.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
        h = h.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
        h = h.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        h = h.replace(/\n\n/g, '</p><p>');
        h = '<p>' + h + '</p>';
        h = h.replace(/([^>])\n([^<])/g, '$1<br>$2');
        return h;
    }
    function renderFull(raw) {
        var explicitOps = exOps(raw), reads = exReads(raw), searches = exSearches(raw), clean = stripTags(raw);
        var implicit = { ops: [], ranges: [] };
        var os = explicitOps;

        if (!explicitOps.length) {
            implicit = exImplicitWriteOps(clean);
            if (implicit.ops.length) {
                os = implicit.ops;
                clean = removeRanges(clean, implicit.ranges);
                clean += '\n\nDetected editable code and converted it to Apply/Reject actions below.';
            }
        }

        var h = mdRender(clean);
        if (os.length) {
            var st = ops.length;
            os.forEach(function (op, i) { ops.push(op); h += mkOpCard(op, st + i); });
        }
        return { html: h, reads: reads, searches: searches };
    }

    function hasGenericCodeBlock(raw) {
        return /```(?!ciper:write)[\s\S]*?```/.test(raw);
    }

    function addUser(text, imgs) {
        var d = document.createElement('div');
        d.className = 'msg um'; d.textContent = text;
        if (imgs && imgs.length) { imgs.forEach(function (u) { var img = document.createElement('img'); img.className = 'uimg'; img.src = u; d.appendChild(img); }); }
        msgs.appendChild(d); scr();
    }
    function showTyp() { typEl = document.createElement('div'); typEl.className = 'msg am td'; typEl.innerHTML = '<span></span><span></span><span></span>'; msgs.appendChild(typEl); scr(); }
    function hideTyp() { if (typEl) { typEl.remove(); typEl = null; } }
    function startAi() { rawBuf = ''; curAi = document.createElement('div'); curAi.className = 'msg am streaming'; msgs.appendChild(curAi); scr(); }
    function addChunk(chunk) {
        if (typEl) { hideTyp(); startAi(); }
        rawBuf += chunk;
        if (curAi) { curAi.innerHTML = mdRender(stripTags(rawBuf)); scr(); }
    }
    function finalAi() {
        if (!curAi) { return; }
        var raw = rawBuf;
        var needsContinue = raw.indexOf(NEED_CONTINUE_TAG) >= 0;
        var cleanRaw = stripTags(raw);
        var foundOps = exOps(raw).length > 0 || exImplicitWriteOps(cleanRaw).ops.length > 0;

        if (!foundOps && hasGenericCodeBlock(cleanRaw) && !autoConvertInFlight && autoConvertBudget > 0) {
            autoConvertInFlight = true;
            autoConvertBudget -= 1;
            curAi.innerHTML = '<p>Detected editable code. Converting to Apply/Reject actions…</p>';
            curAi.classList.remove('streaming');
            curAi = null;
            rawBuf = '';
            VS.postMessage({ command: 'autoConvertEdits', sourceText: cleanRaw.trim() });
            return;
        }

        var r = renderFull(raw);
        curAi.innerHTML = r.html; curAi.classList.remove('streaming');
        curAi = null; rawBuf = '';
        if (r.reads.length) { msgs.appendChild(mkReadCard(r.reads)); scr(); }
        if (r.searches.length) { r.searches.forEach(function (q) { msgs.appendChild(mkSearchCard(q)); }); scr(); }
        if (needsContinue) {
            var cb = document.createElement('button'); cb.className = 'cnb'; cb.textContent = '▶ Continue';
            msgs.appendChild(cb); scr();
        }
        autoConvertInFlight = false;
    }
    function showErr(txt) { var d = document.createElement('div'); d.className = 'em'; d.textContent = txt; msgs.appendChild(d); scr(); }
    function scr() { msgs.scrollTop = msgs.scrollHeight; }

    function stripCtx(t) {
        var cuts = [t.indexOf('\n\n[Project:'), t.indexOf('\n\n[File:'), t.indexOf('\n\nHere are the file contents')];
        var mn = Infinity;
        cuts.forEach(function (c) { if (c >= 0 && c < mn) { mn = c; } });
        return mn === Infinity ? t : t.slice(0, mn);
    }
    function loadHist(messages, sid) {
        msgs.innerHTML = ''; ops = [];
        if (sid) { curSid = sid; ct.textContent = '⚡ ' + fmtSid(sid); }
        (messages || []).forEach(function (m) {
            if (m.role === 'user') { addUser(stripCtx(m.content)); }
            else if (m.role === 'assistant') { var d = document.createElement('div'); d.className = 'msg am'; d.innerHTML = renderFull(m.content).html; msgs.appendChild(d); }
        });
        scr(); showV('c');
    }

    function setSt(on) { streaming = on; sndb.disabled = on; stpb.style.display = on ? 'inline-block' : 'none'; }
    function send() {
        var txt = ci.value.trim();
        if (!txt || streaming) { return; }
        autoConvertBudget = 1;
        autoConvertInFlight = false;
        setSt(true);
        var imgs = imgFiles.slice();
        addUser(txt, imgs);
        ci.value = ''; ci.style.height = 'auto';
        showTyp();
        VS.postMessage({ command: 'sendMessage', text: txt, attachedFiles: atFiles.slice(), images: imgs });
        atFiles = []; imgFiles = [];
        renderAB(); renderIB();
    }
    sndb.addEventListener('click', send);
    stpb.addEventListener('click', function () { VS.postMessage({ command: 'stopStream' }); });
    ci.addEventListener('input', function () { ci.style.height = 'auto'; ci.style.height = Math.min(ci.scrollHeight, 120) + 'px'; });
    ci.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

    window.addEventListener('message', function (e) {
        var m = e.data;
        switch (m.type) {
            case 'init':
                mn.textContent = m.model || '?';
                curSid = m.sessionId || '';
                ct.textContent = '⚡ ' + fmtSid(curSid);
                VS.postMessage({ command: 'loadHistory' });
                break;
            case 'modelChanged': mn.textContent = m.model; break;
            case 'streamStart': if (!streaming) { setSt(true); showTyp(); } break;
            case 'streamChunk': addChunk(m.data); break;
            case 'streamEnd': setSt(false); finalAi(); break;
            case 'streamAborted':
                setSt(false); if (curAi) { finalAi(); } hideTyp();
                autoConvertInFlight = false;
                var nb = document.createElement('div'); nb.className = 'abm'; nb.textContent = '⊘ Stopped'; msgs.appendChild(nb); scr();
                break;
            case 'error': setSt(false); hideTyp(); if (curAi) { finalAi(); } autoConvertInFlight = false; showErr(m.data); break;
            case 'clearHistory': msgs.innerHTML = ''; ops = []; break;
            case 'injectMessage': ci.value = m.text; break;
            case 'historyLoaded': loadHist(m.messages, m.sessionId); break;
            case 'sessionsLoaded': renderSL(m.sessions, m.currentSessionId); break;
            case 'newSessionCreated':
                curSid = m.sessionId; ct.textContent = '⚡ ' + fmtSid(curSid);
                msgs.innerHTML = ''; ops = []; showV('c');
                break;
            case 'sessionDeleted':
                if (m.newCurrentSessionId) { curSid = m.newCurrentSessionId; }
                VS.postMessage({ command: 'loadSessions' });
                break;
            case 'filesAttached':
                (m.files || []).forEach(function (f) { atFiles.push(f); }); renderAB();
                break;
            case 'fileOpDone':
                msgs.querySelectorAll('.foc').forEach(function (c) {
                    var pe = c.querySelector('.fop');
                    if (pe && pe.textContent === m.filePath) {
                        if (m.success) {
                            c.innerHTML = '<div class="fod">✓ Applied: ' + esc(m.filePath) + '</div>';
                            if (m.action === 'patch' && !streaming) {
                                VS.postMessage({ command: 'continueResponse' });
                            }
                        }
                        else { var ab = c.querySelector('.foa-ok'); if (ab) { ab.disabled = false; ab.textContent = '✓ Apply'; } }
                    }
                });
                break;
        }
    });

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function fmtSid(sid) {
        if (sid && sid.startsWith('chat_')) {
            var ts = parseInt(sid.split('_')[1], 10);
            if (!isNaN(ts)) { return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
        }
        return sid || 'Chat';
    }
    function fmtDt(ts) {
        if (!ts) { return ''; }
        try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
        catch (ex) { return String(ts); }
    }

    VS.postMessage({ command: 'webviewReady' });

})();
