/* Huddle — peer-to-peer video meetings (PeerJS mesh + directory peer per room) */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PREFIX = 'huddle-v2-';
  const EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🎉', '🔥', '🤔'];
  const COLORS = ['#e06c4f', '#4f8de0', '#9b5de5', '#2fa37a', '#d9a21b', '#e05297', '#3aa6b9', '#7a8a2a'];
  const BOARD_BG = '#f6f5f0';
  const BOARD_COLORS = ['#16181d', '#e5484d', '#2f7cf6', '#1f9d55', '#f5a524', '#9b5de5'];

  const S = {
    room: '', name: '', me: null, peer: null, dirPeer: null, dirConn: null, roster: new Set(), claiming: false,
    micOn: true, camOn: true, camTrack: null, micTrack: null, blankTrack: null, silentTrack: null, localStream: null,
    screenStream: null, peers: new Map(), hand: false, mirror: true, layout: 'auto', pinned: null,
    strokes: [], chat: [], ccOn: false, rec: null, joinedAt: 0, micId: '', camId: '', noise: true,
    panel: null, inMeeting: false, needSync: false, speaker: null, speakerAt: 0, boardOpen: false, boardNotified: false,
    brush: { c: BOARD_COLORS[0], w: 4, e: false }, session: false, admitted: false, everConnected: false, knock: null,
    waitingRoom: true, waiting: new Map(), allowed: new Set(), pendingIn: new Map(), actx: null, analysers: new Map(), timerInt: null,
  };

  /* ---------- utils ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const letters = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijkmnopqrstuvwxyz'[b % 25]).join('');
  const newCode = () => `${letters(3)}-${letters(4)}-${letters(3)}`;
  const colorFor = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const initial = n => (String(n || '?').trim()[0] || '?').toUpperCase();
  const icons = () => { try { lucide.createIcons({ attrs: { 'aria-hidden': 'true' } }); } catch (e) {} };
  const ico = n => `<i data-lucide="${n}"></i>`;
  const setIcon = (el, n) => { el.innerHTML = ico(n); icons(); };
  const fmtTime = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dirId = () => `${PREFIX}${S.room}-host`;
  const linkFor = code => `${location.href.split('#')[0].split('?')[0]}#/${code}`;
  const inviteText = () => `Join my Huddle video call (code ${S.room}): ${linkFor(S.room)}`;
  async function shareInvite() {
    const text = inviteText();
    try {
      await navigator.clipboard.writeText(text);
      toast('Invite copied. Paste it in any chat or email.', 'check');
    } catch {
      $('#invite-text').value = text;
      $('#modal-invite').hidden = false;
      requestAnimationFrame(() => { $('#invite-text').focus(); $('#invite-text').select(); });
    }
  }

  function toast(msg, icon = 'info') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${ico(icon)}<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t); icons();
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Link copied to clipboard', 'check'); }
    catch { toast('Select the link and copy it manually', 'copy'); }
  }
  function show(view) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  }
  function parseCode(input) {
    const s = String(input || '').trim().toLowerCase();
    const m = s.match(/#\/([a-z0-9-]{3,40})/) || s.match(/[?&]room=([a-z0-9-]{3,40})/) || s.match(/^([a-z0-9-]{3,40})$/);
    return m ? m[1].replace(/^-+|-+$/g, '') : '';
  }
  function audioCtx() {
    if (!S.actx) { try { S.actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (S.actx && S.actx.state === 'suspended') S.actx.resume().catch(() => {});
    return S.actx;
  }
  function chime(up = true) {
    const ctx = audioCtx(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(up ? 660 : 520, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(up ? 990 : 330, ctx.currentTime + .18);
    g.gain.setValueAtTime(.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.08, ctx.currentTime + .02);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .35);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .4);
  }

  /* ---------- clocks ---------- */
  setInterval(() => { const t = fmtTime(new Date()); $('#home-clock').textContent = t + ' · ' + new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); $('#meet-clock').textContent = t; }, 1000);

  /* ---------- media ---------- */
  function blankTrack() {
    if (S.blankTrack && S.blankTrack.readyState === 'live') return S.blankTrack;
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const ctx = c.getContext('2d');
    const paint = () => { ctx.fillStyle = '#1c1f26'; ctx.fillRect(0, 0, 640, 360); };
    paint(); setInterval(paint, 1000);
    S.blankTrack = c.captureStream(5).getVideoTracks()[0];
    return S.blankTrack;
  }
  function silentTrack() {
    if (S.silentTrack && S.silentTrack.readyState === 'live') return S.silentTrack;
    const ctx = audioCtx();
    if (!ctx) return null;
    const dst = ctx.createMediaStreamDestination();
    const o = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0;
    o.connect(g).connect(dst); o.start();
    S.silentTrack = dst.stream.getAudioTracks()[0];
    return S.silentTrack;
  }
  async function getCam() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: S.camId ? { deviceId: { exact: S.camId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
      return s.getVideoTracks()[0];
    } catch (e) { console.warn('cam', e); return null; }
  }
  async function getMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.micId ? { exact: S.micId } : undefined, echoCancellation: S.noise, noiseSuppression: S.noise, autoGainControl: true } });
      return s.getAudioTracks()[0];
    } catch (e) { console.warn('mic', e); return null; }
  }
  async function listDevices() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const fill = (sel, kind, cur) => {
        const list = devs.filter(d => d.kind === kind);
        sel.innerHTML = list.length ? list.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || (kind === 'audioinput' ? 'Microphone ' : 'Camera ') + (i + 1))}</option>`).join('') : `<option value="">None found</option>`;
        if (cur) sel.value = cur;
      };
      const curMic = S.micTrack?.getSettings().deviceId || S.micId, curCam = S.camTrack?.getSettings().deviceId || S.camId;
      ['#sel-mic', '#m-sel-mic'].forEach(s => fill($(s), 'audioinput', curMic));
      ['#sel-cam', '#m-sel-cam'].forEach(s => fill($(s), 'videoinput', curCam));
    } catch {}
  }
  function senders(kind) {
    const out = [];
    S.peers.forEach(p => {
      const pc = p.call?.peerConnection;
      if (!pc) return;
      pc.getTransceivers().forEach(t => { if (t.sender && t.receiver?.track?.kind === kind) out.push(t.sender); });
    });
    return out;
  }
  function setOutgoing(kind, track) {
    if (!track || !S.localStream) return;
    S.localStream.getTracks().filter(t => t.kind === kind).forEach(t => S.localStream.removeTrack(t));
    S.localStream.addTrack(track);
    senders(kind).forEach(s => s.replaceTrack(track).catch(e => console.warn('replaceTrack', e)));
  }

  /* ---------- lobby ---------- */
  function updatePreview() {
    const v = $('#preview-video');
    const on = S.camOn && S.camTrack;
    $('#preview-off').hidden = !!on;
    v.srcObject = on ? new MediaStream([S.camTrack]) : null;
    $('#preview-msg').textContent = S.camOn && !S.camTrack ? 'Camera not available' : 'Camera is off';
    const a = $('#preview-avatar'); const nm = $('#input-name').value || 'You';
    a.textContent = initial(nm); a.style.background = colorFor(nm);
    $('#lobby-mic').classList.toggle('off', !S.micOn); setIcon($('#lobby-mic'), S.micOn ? 'mic' : 'mic-off');
    $('#lobby-cam').classList.toggle('off', !S.camOn); setIcon($('#lobby-cam'), S.camOn ? 'video' : 'video-off');
  }
  async function enterLobby(code) {
    S.room = code;
    try { if (location.hash !== '#/' + code) location.hash = '#/' + code; } catch {}
    document.title = `Huddle · ${code}`;
    $('#lobby-code').textContent = code;
    $('#lobby-link').value = linkFor(code);
    $('#lobby-status').textContent = '';
    if (S.session && !S.inMeeting) endSession();
    setKnock(null);
    show('lobby');
    if (!navigator.mediaDevices?.getUserMedia) {
      $('#lobby-status').textContent = 'Camera and microphone need a secure (https) page. You can still join to chat and watch.';
      S.camOn = false; S.micOn = false; updatePreview(); return;
    }
    $('#lobby-status').textContent = 'Allow camera and microphone access when your browser asks.';
    if (!S.micTrack) S.micTrack = await getMic();
    if (S.camOn && !S.camTrack) S.camTrack = await getCam();
    if (!S.micTrack) { S.micOn = false; }
    if (!S.camTrack) { S.camOn = false; }
    if (S.micTrack) S.micTrack.enabled = S.micOn;
    $('#lobby-status').textContent = (!S.micTrack && !S.camTrack)
      ? 'No camera or microphone access. Check browser permissions, or join without them.'
      : '';
    updatePreview(); listDevices(); startLobbyMeter();
    setTimeout(() => $('#input-name').focus(), 50);
  }
  let lobbyMeterRAF = 0;
  function startLobbyMeter() {
    cancelAnimationFrame(lobbyMeterRAF);
    const ctx = audioCtx(); if (!ctx || !S.micTrack) return;
    const an = ctx.createAnalyser(); an.fftSize = 256;
    ctx.createMediaStreamSource(new MediaStream([S.micTrack])).connect(an);
    const buf = new Uint8Array(an.fftSize); const bars = $$('#preview-meter i');
    const loop = () => {
      if (!$('#view-lobby').classList.contains('active')) return;
      an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      const lvl = S.micOn ? Math.min(1, Math.sqrt(sum / buf.length) * 6) : 0;
      bars.forEach((b, i) => b.style.height = (4 + lvl * 16 * [0.6, 1, 0.75][i]) + 'px');
      lobbyMeterRAF = requestAnimationFrame(loop);
    };
    loop();
  }

  $('#btn-new').onclick = () => { audioCtx(); enterLobby(newCode()); };
  $('#form-join').onsubmit = e => {
    e.preventDefault(); audioCtx();
    const c = parseCode($('#input-code').value);
    if (!c) { toast('Enter a meeting code like abc-defg-hij or paste a link', 'alert-circle'); return; }
    enterLobby(c);
  };
  $('#lobby-home').onclick = goHome;
  $('#lobby-copy').onclick = shareInvite;
  $('#ctl-share').onclick = shareInvite;
  $('#meet-share').onclick = shareInvite;
  $('#invite-copy').onclick = () => { $('#invite-text').select(); try { document.execCommand('copy'); toast('Invite copied', 'check'); } catch {} };
  $$('#modal-invite [data-close]').forEach(b => b.onclick = () => $('#modal-invite').hidden = true);
  $('#lobby-link').onclick = e => e.target.select();
  $('#input-name').oninput = updatePreview;
  $('#input-name').onkeydown = e => { if (e.key === 'Enter') $('#btn-join').click(); };
  $('#lobby-mic').onclick = async () => {
    audioCtx();
    if (!S.micTrack) { S.micTrack = await getMic(); if (!S.micTrack) { toast('Microphone is blocked or missing', 'mic-off'); return; } startLobbyMeter(); listDevices(); S.micOn = true; }
    else S.micOn = !S.micOn;
    S.micTrack.enabled = S.micOn; updatePreview();
  };
  $('#lobby-cam').onclick = async () => {
    if (S.camOn) { S.camTrack?.stop(); S.camTrack = null; S.camOn = false; }
    else { S.camTrack = await getCam(); S.camOn = !!S.camTrack; if (!S.camTrack) toast('Camera is blocked or missing', 'video-off'); listDevices(); }
    updatePreview();
  };
  $('#sel-mic').onchange = e => switchMic(e.target.value);
  $('#sel-cam').onchange = e => switchCam(e.target.value);
  $('#m-sel-mic').onchange = e => switchMic(e.target.value);
  $('#m-sel-cam').onchange = e => switchCam(e.target.value);
  $('#m-noise').onchange = e => { S.noise = e.target.checked; switchMic(S.micId); };

  async function switchMic(id) {
    S.micId = id;
    const t = await getMic(); if (!t) { toast('Could not switch microphone', 'mic-off'); return; }
    S.micTrack?.stop(); S.micTrack = t; t.enabled = S.micOn;
    if (S.inMeeting) { setOutgoing('audio', t); attachAnalyser('me', new MediaStream([t])); }
    else startLobbyMeter();
  }
  async function switchCam(id) {
    S.camId = id;
    if (!S.camOn) return;
    const t = await getCam(); if (!t) { toast('Could not switch camera', 'video-off'); return; }
    S.camTrack?.stop(); S.camTrack = t;
    if (S.inMeeting) { setOutgoing('video', t); renderLocal(); } else updatePreview();
  }

  /* ---------- join / peers ---------- */
  function makePeer(id) {
    return new Promise((res, rej) => {
      let done = false;
      const p = new Peer(id, { debug: 1 });
      const fin = (ok, val) => { if (done) return; done = true; p.off('open', onOpen); p.off('error', onErr); ok ? res(p) : (() => { try { p.destroy(); } catch {} rej(val); })(); };
      const onOpen = () => fin(true);
      const onErr = e => fin(false, e);
      p.on('open', onOpen); p.on('error', onErr);
      setTimeout(() => fin(false, Object.assign(new Error('timeout'), { type: 'timeout' })), 15000);
    });
  }

  $('#btn-join').onclick = async () => {
    audioCtx();
    const btn = $('#btn-join'); btn.disabled = true; btn.textContent = 'Connecting…';
    S.name = ($('#input-name').value || '').trim() || 'Guest';
    try {
      S.me = `${PREFIX}${S.room}-${rand(8)}`;
      S.peer = await makePeer(S.me);
    } catch (e) {
      console.error(e);
      $('#lobby-status').textContent = 'Could not reach the connection server. Check your internet and try again.';
      btn.disabled = false; btn.textContent = 'Join now'; return;
    }
    btn.disabled = false; btn.textContent = 'Join now';
    S.session = true; S.admitted = false; S.everConnected = false;
    wirePeer(S.peer);
    setKnock('asking');
    connectDirectory();
  };

  /* knocking UI in the lobby */
  function setKnock(state) {
    S.knock = state;
    const box = $('#knock'), join = $('#btn-join');
    join.hidden = !!state && state !== 'denied';
    box.hidden = !state;
    if (!state) return;
    box.dataset.state = state;
    $('#knock-title').textContent = state === 'denied' ? 'Your request was declined' : state === 'waiting' ? 'Asking to join…' : 'Connecting to the room…';
    $('#knock-text').textContent = state === 'denied'
      ? 'Someone in the call declined your request. You can ask again.'
      : state === 'waiting' ? 'You\'ll join the call when the host lets you in.' : 'Looking for the meeting host.';
    $('#knock-cancel').hidden = state === 'denied';
    join.textContent = state === 'denied' ? 'Ask to join again' : 'Join now';
  }
  $('#knock-cancel').onclick = () => { endSession(); setKnock(null); $('#lobby-status').textContent = 'Request cancelled.'; };

  function endSession() {
    S.session = false; S.admitted = false;
    try { S.dirConn?.close(); } catch {}
    S.dirConn = null;
    try { S.dirPeer?.destroy(); } catch {} S.dirPeer = null;
    try { S.peer?.destroy(); } catch {} S.peer = null;
  }

  function becomeAdmitted() {
    if (S.admitted) return;
    S.admitted = true;
    setKnock(null);
    startMeeting();
  }

  function startMeeting() {
    S.inMeeting = true; S.joinedAt = Date.now(); S.needSync = true; S.boardNotified = false;
    const v = (S.camOn && S.camTrack) ? S.camTrack : blankTrack();
    const a = S.micTrack || silentTrack();
    S.localStream = new MediaStream([v, a].filter(Boolean));
    if (S.micTrack) S.micTrack.enabled = S.micOn;
    show('meet');
    $('#bar-code').textContent = S.room; $('#meet-code').textContent = S.room; $('#meet-link').value = linkFor(S.room);
    $('#invite-text').value = inviteText();
    renderLocal(); syncControls(); renderPeople(); renderHostUI(); layout();
    clearInterval(S.timerInt);
    S.timerInt = setInterval(() => { const s = Math.floor((Date.now() - S.joinedAt) / 1000); $('#meet-timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 1000);
    startSpeakerLoop();
    addSys(`You joined ${S.room}`);
    setTimeout(() => { if (S.inMeeting && S.peers.size === 0) toast('You\'re the first one here. Use Share to invite people.', 'link'); }, 2500);
  }

  /* Only accept connections from people the host has admitted */
  function gate(id, ok, no) {
    if (!S.admitted) return no();
    if (S.peers.has(id) || S.allowed.has(id)) return ok();
    let q = S.pendingIn.get(id);
    if (!q) { q = { items: [], timer: setTimeout(() => { S.pendingIn.delete(id); q.items.forEach(i => i.no()); }, 10000) }; S.pendingIn.set(id, q); }
    q.items.push({ ok, no });
  }
  function allow(id) {
    S.allowed.add(id);
    const q = S.pendingIn.get(id);
    if (q) { clearTimeout(q.timer); S.pendingIn.delete(id); q.items.forEach(i => i.ok()); }
  }

  function wirePeer(peer) {
    peer.on('connection', conn => gate(conn.peer, () => setupConn(conn), () => { try { conn.close(); } catch {} }));
    peer.on('call', call => gate(call.peer, () => handleCall(call), () => { try { call.close(); } catch {} }));
    peer.on('disconnected', () => { if (S.session && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch {} }, 1000); });
    peer.on('error', e => {
      console.warn('peer error', e.type, e.message);
      if (e.type === 'peer-unavailable') {
        const m = String(e.message).match(/peer\s+(\S+)/i); const id = m ? m[1] : '';
        if (id === dirId()) dirMissing();
        else if (id) removePeer(id, true);
      } else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') {
        toast('Connection to signaling server was interrupted. Reconnecting…', 'wifi-off');
      }
    });
  }

  /* Nobody is hosting the room: admitted members take over right away; a person still
     waiting only takes over if they never reached a host (an empty room). */
  function dirMissing() {
    if (!S.session || S.dirPeer) return;
    if (S.admitted || !S.everConnected) claimDirectory();
    else setTimeout(() => { if (S.session && !S.admitted && !S.dirPeer) connectDirectory(); }, 2500 + Math.random() * 1500);
  }

  function connectDirectory() {
    if (!S.session || S.dirPeer || !S.peer || S.peer.destroyed) return;
    const c = S.peer.connect(dirId(), { reliable: true });
    S.dirConn = c; let opened = false;
    c.on('open', () => { opened = true; S.everConnected = true; c.send({ t: 'join', id: S.me, name: S.name, member: S.admitted }); });
    c.on('data', d => {
      if (!d) return;
      if (d.t === 'wait') setKnock('waiting');
      else if (d.t === 'denied') { S.denied = true; endSession(); setKnock('denied'); }
      else if (d.t === 'roster') {
        becomeAdmitted();
        d.ids.forEach(id => { if (id !== S.me && !S.peers.has(id)) connectTo(id); });
      }
    });
    c.on('close', () => {
      if (S.dirConn === c) { S.dirConn = null; if (S.session) setTimeout(connectDirectory, (S.admitted ? 300 : 2500) + Math.random() * 1500); }
    });
    setTimeout(() => { if (!opened && S.dirConn === c) { S.dirConn = null; try { c.close(); } catch {} dirMissing(); } }, 7000);
  }

  async function claimDirectory() {
    if (!S.session || S.dirPeer || S.claiming) return;
    S.claiming = true;
    try {
      const dp = await makePeer(dirId());
      if (!S.session) { dp.destroy(); return; }
      S.dirPeer = dp; S.dirConn = null;
      S.roster = new Set([S.me, ...S.peers.keys()]);
      dp.on('connection', c => {
        c.on('data', d => {
          if (!d || d.t !== 'join' || typeof d.id !== 'string') return;
          c._pid = d.id; c._name = String(d.name || 'Guest').slice(0, 32);
          if (S.peers.has(d.id) || S.roster.has(d.id) || !S.waitingRoom) admitConn(c);
          else {
            S.waiting.set(d.id, c); c.send({ t: 'wait' });
            renderWaiting(); knockAlert(d.id, c._name);
          }
        });
        c.on('close', () => {
          if (S.waiting.get(c._pid) === c) { S.waiting.delete(c._pid); renderWaiting(); }
          if (c._pid && c._pid !== S.me && !S.peers.has(c._pid)) S.roster.delete(c._pid);
        });
      });
      dp.on('disconnected', () => { if (S.session && !dp.destroyed) setTimeout(() => { try { dp.reconnect(); } catch {} }, 1000); });
      dp.on('error', e => console.warn('dir error', e.type));
      if (!S.admitted) { becomeAdmitted(); toast('You\'re the host. People who open your link will ask to join.', 'shield-check'); }
      else { toast('You\'re now the host of this call', 'shield-check'); broadcast(myInfo()); }
      renderHostUI(); renderPeople();
    } catch (e) {
      if (e.type === 'unavailable-id') setTimeout(connectDirectory, 500 + Math.random() * 800);
      else setTimeout(connectDirectory, 2500);
    } finally { S.claiming = false; }
  }

  /* host actions */
  function admitConn(c) {
    const id = c._pid;
    S.waiting.delete(id);
    allow(id);
    broadcast({ t: 'admit', id });
    try { c.send({ t: 'roster', ids: [...S.roster].filter(x => x !== id) }); } catch {}
    S.roster.add(id);
    dismissKnock(id); renderWaiting();
  }
  function admit(id) { const c = S.waiting.get(id); if (c) { admitConn(c); toast(`${c._name} was let in`, 'user-check'); } }
  function deny(id) {
    const c = S.waiting.get(id); if (!c) return;
    S.waiting.delete(id);
    try { c.send({ t: 'denied' }); } catch {}
    setTimeout(() => { try { c.close(); } catch {} }, 800);
    dismissKnock(id); renderWaiting();
  }
  function admitAll() { [...S.waiting.keys()].forEach(admit); }

  function knockAlert(id, name) {
    chime(true);
    dismissKnock(id);
    const el = document.createElement('div');
    el.className = 'knock-card'; el.dataset.knock = id;
    el.innerHTML = `<div class="avatar sm" style="background:${colorFor(name)}">${esc(initial(name))}</div>
      <div class="kc-text"><b>${esc(name)}</b><span>wants to join this call</span></div>
      <button class="btn btn-ghost sm" data-deny>Deny</button><button class="btn btn-primary sm" data-admit>Admit</button>`;
    el.querySelector('[data-admit]').onclick = () => admit(id);
    el.querySelector('[data-deny]').onclick = () => deny(id);
    $('#knocks').appendChild(el);
  }
  function dismissKnock(id) { $(`[data-knock="${CSS.escape(id)}"]`)?.remove(); }

  function renderWaiting() {
    const list = [...S.waiting.entries()];
    $('#waiting-section').hidden = !list.length;
    $('#waiting-count').textContent = list.length;
    $('#admit-all').hidden = list.length < 2;
    $('#waiting').innerHTML = list.map(([id, c]) => `<li>
      <div class="avatar sm" style="background:${colorFor(c._name)}">${esc(initial(c._name))}</div>
      <div class="pname">${esc(c._name)}</div>
      <button class="btn btn-ghost sm" data-w-deny="${esc(id)}">Deny</button>
      <button class="btn btn-primary sm" data-w-admit="${esc(id)}">Admit</button></li>`).join('');
    $('#badge-wait').hidden = !list.length;
    $('#badge-wait').textContent = list.length;
    // drop alerts for people who stopped waiting
    $$('[data-knock]').forEach(k => { if (!S.waiting.has(k.dataset.knock)) k.remove(); });
  }
  $('#waiting').onclick = e => {
    const a = e.target.closest('[data-w-admit]'), d = e.target.closest('[data-w-deny]');
    if (a) admit(a.dataset.wAdmit); else if (d) deny(d.dataset.wDeny);
  };
  $('#admit-all').onclick = admitAll;
  function renderHostUI() {
    const host = !!S.dirPeer;
    $('#host-settings').hidden = !host;
    $('#wr-toggle').checked = S.waitingRoom;
  }
  $('#wr-toggle').onchange = e => {
    S.waitingRoom = e.target.checked;
    if (!S.waitingRoom) { admitAll(); toast('Waiting room off. People join automatically.', 'door-open'); }
    else toast('Waiting room on. You\'ll admit people before they join.', 'shield-check');
  };

  function ensurePeer(id) {
    let p = S.peers.get(id);
    if (!p) {
      p = { id, name: 'Guest', mic: true, cam: false, hand: false, sharing: false, host: false, conn: null, call: null, stream: null, screenCall: null, screenStream: null, outScreen: null, announced: false };
      S.peers.set(id, p);
      if (S.dirPeer) S.roster.add(id);
    }
    return p;
  }
  function myInfo() { return { t: 'info', name: S.name, mic: S.micOn, cam: !!(S.camOn && S.camTrack), hand: S.hand, sharing: !!S.screenStream, host: !!S.dirPeer }; }
  function broadcast(msg) { S.peers.forEach(p => { if (p.conn && p.conn.open) { try { p.conn.send(msg); } catch {} } }); }

  function connectTo(id) {
    if (S.peers.has(id)) return;
    const p = ensurePeer(id);
    const conn = S.peer.connect(id, { reliable: true, metadata: { name: S.name } });
    setupConn(conn);
    const call = S.peer.call(id, S.localStream, { metadata: { type: 'cam', name: S.name } });
    if (call) setupCall(p, call);
    renderPeer(p); layout();
  }

  function setupConn(conn) {
    const id = conn.peer; const p = ensurePeer(id);
    if (conn.metadata?.name) p.name = conn.metadata.name;
    if (p.conn && p.conn !== conn) { try { p.conn.close(); } catch {} }
    p.conn = conn;
    conn.on('open', () => {
      conn.send(myInfo());
      if (S.screenStream) shareScreenTo(id);
      if (S.needSync) { S.needSync = false; conn.send({ t: 'sync-req' }); }
    });
    conn.on('data', d => onData(p, d));
    conn.on('close', () => { if (p.conn === conn) removePeer(id); });
    conn.on('error', e => console.warn('conn error', e));
    renderPeer(p); layout();
  }

  function handleCall(call) {
    const id = call.peer; const p = ensurePeer(id);
    if (call.metadata?.type === 'screen') {
      call.answer();
      p.screenCall = call;
      call.on('stream', s => { p.screenStream = s; p.sharing = true; renderScreen(p); layout(); });
      call.on('close', () => dropScreen(p));
    } else {
      if (call.metadata?.name) p.name = call.metadata.name;
      call.answer(S.localStream);
      setupCall(p, call);
    }
  }
  function setupCall(p, call) {
    if (p.call && p.call !== call) { try { p.call.close(); } catch {} }
    p.call = call;
    call.on('stream', s => { p.stream = s; renderPeer(p); attachAnalyser(p.id, s); layout(); });
    call.on('error', e => console.warn('call error', e));
    const watch = () => {
      const pc = call.peerConnection; if (!pc) return setTimeout(watch, 200);
      pc.addEventListener('iceconnectionstatechange', () => {
        const st = pc.iceConnectionState;
        const tile = $(`[data-key="${CSS.escape(p.id)}"]`);
        if (tile) tile.querySelector('.conn')?.toggleAttribute('hidden', !(st === 'disconnected' || st === 'checking' || st === 'new'));
        if (st === 'failed') { toast(`Connection to ${p.name} failed (network may block peer-to-peer)`, 'wifi-off'); }
      });
    };
    watch();
  }

  function removePeer(id, silent) {
    const p = S.peers.get(id); if (!p) return;
    S.peers.delete(id); S.roster.delete(id);
    [p.conn, p.call, p.screenCall, p.outScreen].forEach(c => { try { c && c.close(); } catch {} });
    $(`[data-key="${CSS.escape(id)}"]`)?.remove();
    $(`[data-key="${CSS.escape(id + '::screen')}"]`)?.remove();
    S.analysers.delete(id);
    if (S.pinned === id || S.pinned === id + '::screen') S.pinned = null;
    $(`[data-cap="${CSS.escape(id)}"]`)?.remove();
    if (!silent && p.announced && S.inMeeting) { toast(`${p.name} left`, 'log-out'); addSys(`${p.name} left`); chime(false); }
    renderPeople(); layout();
  }

  function onData(p, d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'info': {
        const wasHand = p.hand, wasSharing = p.sharing;
        p.name = String(d.name || 'Guest').slice(0, 32); p.mic = !!d.mic; p.cam = !!d.cam; p.hand = !!d.hand; p.sharing = !!d.sharing; p.host = !!d.host;
        if (!p.announced) { p.announced = true; toast(`${p.name} joined`, 'user-plus'); addSys(`${p.name} joined`); chime(true); }
        if (p.hand && !wasHand) toast(`${p.name} raised their hand`, 'hand');
        if (!p.sharing && wasSharing) dropScreen(p);
        renderPeer(p); if (p.screenStream) renderScreen(p); renderPeople(); layout();
        break;
      }
      case 'admit': if (typeof d.id === 'string') allow(d.id); break;
      case 'chat': addMsg({ from: p.name, text: String(d.text).slice(0, 1000), ts: d.ts || Date.now(), mine: false }); break;
      case 'react': floatReaction(String(d.e).slice(0, 4), p.name); break;
      case 'screen-stop': dropScreen(p); break;
      case 'cap': showCaption(p.id, p.name, String(d.text).slice(0, 300), d.final); break;
      case 'draw': if (Array.isArray(d.s)) { d.s.forEach(seg => { S.strokes.push(seg); drawSeg(seg); }); if (!S.boardOpen && !S.boardNotified) { S.boardNotified = true; toast(`${p.name} is drawing on the whiteboard`, 'pen-tool'); } } break;
      case 'board-clear': S.strokes = []; redrawBoard(); toast(`${p.name} cleared the whiteboard`, 'eraser'); break;
      case 'sync-req': p.conn?.send({ t: 'sync', strokes: S.strokes.slice(-20000), chat: S.chat.slice(-200) }); break;
      case 'sync':
        if (Array.isArray(d.strokes) && d.strokes.length) { S.strokes = d.strokes.concat(S.strokes); redrawBoard(); }
        if (Array.isArray(d.chat)) d.chat.forEach(m => addMsg({ ...m, mine: false, history: true }));
        break;
    }
  }

  /* ---------- tiles ---------- */
  function tileEl(key, opts = {}) {
    let el = $(`[data-key="${CSS.escape(key)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tile'; el.dataset.key = key; el.tabIndex = 0;
      el.innerHTML = `<video autoplay playsinline></video>
        <div class="cover"><div class="avatar"></div></div>
        <div class="conn" hidden>Connecting…</div>
        <div class="eq"><i></i><i></i><i></i></div>
        <div class="hand" hidden>${ico('hand')} Hand raised</div>
        <div class="tile-actions"><button class="pin" aria-label="Pin to spotlight" title="Pin">${ico('pin')}</button></div>
        <div class="label"><span class="mic-ind"></span><span class="nm"></span></div>`;
      el.querySelector('.pin').onclick = () => { S.pinned = S.pinned === key ? null : key; layout(); };
      el.ondblclick = () => { S.pinned = S.pinned === key ? null : key; layout(); };
      $('#grid').appendChild(el); icons();
    }
    if (opts.muted) el.querySelector('video').muted = true;
    return el;
  }
  function setVideo(el, stream) {
    const v = el.querySelector('video');
    if (v.srcObject !== stream) { v.srcObject = stream; }
    if (stream) v.play().catch(() => {});
  }
  function paintTile(el, { name, mic, cam, hand, screen, mirror }) {
    el.classList.toggle('cam-on', !!cam); el.classList.toggle('screen', !!screen); el.classList.toggle('mirror', !!mirror);
    const av = el.querySelector('.avatar'); av.textContent = initial(name); av.style.background = colorFor(name);
    el.querySelector('.nm').textContent = name;
    const mi = el.querySelector('.mic-ind');
    const want = screen ? 'monitor-up' : (mic ? '' : 'mic-off');
    if (mi.dataset.i !== want) { mi.dataset.i = want; mi.className = 'mic-ind' + (want === 'mic-off' ? ' mic-off' : ''); mi.innerHTML = want ? ico(want) : ''; icons(); }
    el.querySelector('.hand').hidden = !hand;
    const pin = el.querySelector('.pin'); pin.title = S.pinned === el.dataset.key ? 'Unpin' : 'Pin';
  }
  function renderLocal() {
    const el = tileEl('me', { muted: true });
    const cam = !!(S.camOn && S.camTrack);
    setVideo(el, cam ? new MediaStream([S.camTrack]) : null);
    paintTile(el, { name: `${S.name} (You)`, mic: S.micOn, cam, hand: S.hand, mirror: S.mirror });
    if (S.micTrack && S.analysers.get('me')?.tid !== S.micTrack.id) attachAnalyser('me', new MediaStream([S.micTrack]));
  }
  function renderPeer(p) {
    const el = tileEl(p.id);
    if (p.stream) setVideo(el, p.stream);
    paintTile(el, { name: p.name, mic: p.mic, cam: p.cam && !!p.stream, hand: p.hand });
    el.querySelector('.conn').hidden = !!p.stream;
  }
  function renderScreen(p) {
    const key = p.id + '::screen';
    const el = tileEl(key);
    el.querySelector('video').muted = false;
    setVideo(el, p.screenStream);
    paintTile(el, { name: `${p.name} is presenting`, mic: true, cam: true, screen: true });
    if (!S.pinned) S.pinned = key;
  }
  function dropScreen(p) {
    p.sharing = false; p.screenStream = null;
    try { p.screenCall?.close(); } catch {}
    p.screenCall = null;
    const key = p.id + '::screen';
    $(`[data-key="${CSS.escape(key)}"]`)?.remove();
    if (S.pinned === key) S.pinned = null;
    layout();
  }

  /* layout */
  function layout() {
    if (!S.inMeeting) return;
    const stage = $('#stage'), grid = $('#grid'), spot = $('#spotlight');
    const tiles = $$('.tile', stage);
    const keys = tiles.map(t => t.dataset.key);
    if (S.pinned && !keys.includes(S.pinned)) S.pinned = null;
    let spotKey = null;
    const screens = keys.filter(k => k.endsWith('::screen'));
    if (S.layout !== 'grid') {
      spotKey = S.pinned || screens[0] || null;
      if (!spotKey && S.layout === 'spotlight' && tiles.length > 1) {
        spotKey = (S.speaker && keys.includes(S.speaker) && S.speaker !== 'me') ? S.speaker : keys.find(k => k !== 'me') || 'me';
      }
    }
    if (tiles.length < 2 && !screens.length) spotKey = null;
    stage.classList.toggle('spot', !!spotKey);
    const order = k => k === 'me-screen' ? 0 : k.endsWith('::screen') ? 1 : k === 'me' ? 2 : 3;
    tiles.sort((a, b) => order(a.dataset.key) - order(b.dataset.key));
    tiles.forEach(t => {
      const target = t.dataset.key === spotKey ? spot : grid;
      if (t.parentElement !== target) { target.appendChild(t); t.querySelector('video').play().catch(() => {}); }
      t.querySelector('.pin').innerHTML = ico(S.pinned === t.dataset.key ? 'pin-off' : 'pin');
    });
    icons();
    fitGrid();
    $('#layout-label').textContent = S.layout === 'spotlight' ? 'Switch to grid' : S.layout === 'grid' ? 'Switch to auto layout' : 'Switch to spotlight';
    const n = S.peers.size + 1; $('#badge-people').textContent = n; $('#people-count').textContent = n;
  }
  function fitGrid() {
    const grid = $('#grid'); const stage = $('#stage');
    if (stage.classList.contains('spot')) { grid.style.gridTemplateColumns = ''; grid.style.gridAutoRows = ''; $$('.tile', grid).forEach(t => t.style.width = ''); return; }
    const n = grid.children.length || 1;
    const W = stage.clientWidth, H = stage.clientHeight, gap = 10;
    // try several tile shapes so portrait phones get tall tiles and wide screens get 16:9
    const ratios = W / H < 0.9 ? [16 / 9, 4 / 3, 1, 3 / 4] : W / H < 1.4 ? [16 / 9, 4 / 3] : [16 / 9];
    let best = { area: 0, w: 0, h: 0, cols: 1 };
    for (const r of ratios) for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * r);
      const area = w * (w / r) * (r === 16 / 9 ? 1.08 : 1);
      if (area > best.area) best = { area, w, h: w / r, cols };
    }
    grid.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(best.w)}px)`;
    grid.style.gridAutoRows = `${Math.floor(best.h)}px`;
  }
  new ResizeObserver(() => fitGrid()).observe($('#stage'));

  /* active speaker */
  function attachAnalyser(key, stream) {
    const ctx = audioCtx(); if (!ctx || !stream.getAudioTracks().length) return;
    try {
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      S.analysers.set(key, { an, buf: new Uint8Array(an.fftSize), lvl: 0, tid: stream.getAudioTracks()[0].id });
    } catch (e) { console.warn('analyser', e); }
  }
  let speakerInt = 0;
  function startSpeakerLoop() {
    clearInterval(speakerInt);
    speakerInt = setInterval(() => {
      let loudest = null, max = 0;
      S.analysers.forEach((a, key) => {
        a.an.getByteTimeDomainData(a.buf); let sum = 0; for (const v of a.buf) { const x = (v - 128) / 128; sum += x * x; }
        let lvl = Math.sqrt(sum / a.buf.length);
        const muted = key === 'me' ? !S.micOn : !(S.peers.get(key)?.mic);
        if (muted) lvl = 0;
        a.lvl = a.lvl * 0.5 + lvl * 0.5;
        const el = $(`[data-key="${CSS.escape(key)}"]`); if (!el) return;
        const on = a.lvl > 0.02;
        el.classList.toggle('speaking', on);
        el.querySelectorAll('.eq i').forEach((b, i) => b.style.height = on ? (3 + Math.min(11, a.lvl * 160 * [0.7, 1, 0.8][i])) + 'px' : '3px');
        if (a.lvl > max && on) { max = a.lvl; loudest = key; }
      });
      if (loudest && loudest !== S.speaker && Date.now() - S.speakerAt > 1500) {
        S.speaker = loudest; S.speakerAt = Date.now();
        if (S.layout === 'spotlight' && !S.pinned) layout();
      }
    }, 120);
  }

  /* ---------- controls ---------- */
  function syncControls() {
    const mic = $('#ctl-mic'), cam = $('#ctl-cam');
    mic.classList.toggle('off', !S.micOn); setIcon(mic, S.micOn ? 'mic' : 'mic-off');
    const camOn = !!(S.camOn && S.camTrack);
    cam.classList.toggle('off', !camOn); setIcon(cam, camOn ? 'video' : 'video-off');
    $('#ctl-screen').classList.toggle('on', !!S.screenStream);
    $('#ctl-hand').classList.toggle('on', S.hand);
    const hl = $('#hand-label'); if (hl) hl.textContent = S.hand ? 'Lower hand' : 'Raise hand';
    $('#ctl-cc').classList.toggle('on', S.ccOn);
    $('#ctl-board').classList.toggle('on', S.boardOpen);
  }
  async function toggleMic() {
    if (!S.micTrack) {
      const t = await getMic(); if (!t) { toast('Microphone is blocked. Allow it in your browser settings.', 'mic-off'); return; }
      S.micTrack = t; setOutgoing('audio', t); attachAnalyser('me', new MediaStream([t])); S.micOn = true; listDevices();
    } else S.micOn = !S.micOn;
    S.micTrack.enabled = S.micOn;
    if (!S.micOn) stopRecognition(); else if (S.ccOn) startRecognition();
    syncControls(); renderLocal(); broadcast(myInfo()); renderPeople();
  }
  async function toggleCam() {
    if (S.camOn && S.camTrack) {
      S.camTrack.stop(); S.camTrack = null; S.camOn = false; setOutgoing('video', blankTrack());
    } else {
      const t = await getCam(); if (!t) { toast('Camera is blocked. Allow it in your browser settings.', 'video-off'); return; }
      S.camTrack = t; S.camOn = true; setOutgoing('video', t); listDevices();
    }
    syncControls(); renderLocal(); broadcast(myInfo()); renderPeople();
  }
  $('#ctl-mic').onclick = toggleMic;
  $('#ctl-cam').onclick = toggleCam;

  /* screen share */
  async function toggleScreen() {
    if (S.screenStream) return stopScreen();
    if (!navigator.mediaDevices?.getDisplayMedia) { toast('Screen sharing isn\'t supported on this device', 'monitor-x'); return; }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
      S.screenStream = s;
      s.getVideoTracks()[0].addEventListener('ended', stopScreen);
      S.peers.forEach((p, id) => shareScreenTo(id));
      const el = tileEl('me-screen', { muted: true });
      setVideo(el, s);
      paintTile(el, { name: 'You are presenting', mic: true, cam: true, screen: true });
      S.pinned = 'me-screen';
      broadcast(myInfo()); syncControls(); layout();
      toast('You\'re sharing your screen', 'monitor-up');
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('Screen sharing is blocked in this window. Open the site in its own tab.', 'monitor-x');
    }
  }
  function shareScreenTo(id) {
    const p = S.peers.get(id); if (!p || !S.screenStream) return;
    try { p.outScreen?.close(); } catch {}
    p.outScreen = S.peer.call(id, S.screenStream, { metadata: { type: 'screen' } });
  }
  function stopScreen() {
    if (!S.screenStream) return;
    S.screenStream.getTracks().forEach(t => t.stop()); S.screenStream = null;
    S.peers.forEach(p => { try { p.outScreen?.close(); } catch {} p.outScreen = null; });
    broadcast({ t: 'screen-stop' }); broadcast(myInfo());
    $('[data-key="me-screen"]')?.remove();
    if (S.pinned === 'me-screen') S.pinned = null;
    syncControls(); layout();
  }
  $('#ctl-screen').onclick = toggleScreen;

  /* hand */
  function toggleHand() { S.hand = !S.hand; syncControls(); renderLocal(); broadcast(myInfo()); renderPeople(); if (S.hand) toast('You raised your hand', 'hand'); }
  $('#ctl-hand').onclick = toggleHand;

  /* reactions */
  const rp = $('#react-pop');
  rp.innerHTML = EMOJIS.map(e => `<button class="em-btn" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('');
  rp.onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; floatReaction(b.dataset.e, 'You'); broadcast({ t: 'react', e: b.dataset.e }); };
  $('#ctl-react').onclick = e => { e.stopPropagation(); $('#more-pop').hidden = true; rp.hidden = !rp.hidden; };
  function floatReaction(em, who) {
    const el = document.createElement('div'); el.className = 'float-react';
    el.style.left = (8 + Math.random() * 30) + '%';
    el.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
    el.innerHTML = `<span class="em">${esc(em)}</span><span class="who">${esc(who)}</span>`;
    $('#reactions-layer').appendChild(el);
    setTimeout(() => el.remove(), 3700);
  }

  /* more menu */
  $('#ctl-more').onclick = e => { e.stopPropagation(); rp.hidden = true; $('#more-pop').hidden = !$('#more-pop').hidden; };
  document.addEventListener('click', e => { if (!e.target.closest('.pop-wrap')) { rp.hidden = true; $('#more-pop').hidden = true; } });
  $('#more-pop').onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    $('#more-pop').hidden = true;
    const a = b.dataset.act;
    if (a === 'layout') { S.layout = S.layout === 'auto' ? 'spotlight' : S.layout === 'spotlight' ? 'grid' : 'auto'; S.pinned = null; layout(); toast(`Layout: ${S.layout}`, 'layout-grid'); }
    else if (a === 'mirror') { S.mirror = !S.mirror; renderLocal(); }
    else if (a === 'devices') { listDevices(); $('#modal-devices').hidden = false; }
    else if (a === 'share') shareInvite();
    else if (a === 'hand') $('#ctl-hand').click();
    else if (a === 'cc') toggleCC();
    else if (a === 'board') toggleBoard();
    else openPanel(a);
  };
  $$('#modal-devices [data-close]').forEach(b => b.onclick = () => $('#modal-devices').hidden = true);
  $('#modal-devices').onclick = e => { if (e.target.id === 'modal-devices') e.currentTarget.hidden = true; };

  /* ---------- panel ---------- */
  function openPanel(tab) {
    if (S.panel === tab && !$('#panel').hidden) { closePanel(); return; }
    S.panel = tab; $('#panel').hidden = false;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $$('.tab-body').forEach(b => b.hidden = b.dataset.body !== tab);
    $$('[data-open]').forEach(b => b.classList.toggle('active', b.dataset.open === tab));
    if (tab === 'chat') { $('#badge-chat').hidden = true; $('#badge-more').hidden = true; setTimeout(() => $('#chat-input').focus(), 30); scrollChat(); }
    if (tab === 'people') renderPeople();
    requestAnimationFrame(fitGrid);
  }
  function closePanel() { $('#panel').hidden = true; S.panel = null; $$('[data-open]').forEach(b => b.classList.remove('active')); requestAnimationFrame(fitGrid); }
  $$('[data-open]').forEach(b => b.onclick = () => openPanel(b.dataset.open));
  $$('.tab').forEach(t => t.onclick = () => openPanel(t.dataset.tab));
  $('#panel-close').onclick = closePanel;
  $('#meet-copy').onclick = () => copy($('#meet-link').value);
  $('#meet-link').onclick = e => e.target.select();

  function renderPeople() {
    const rows = [{ name: `${S.name} (You)`, mic: S.micOn, cam: !!(S.camOn && S.camTrack), hand: S.hand, sharing: !!S.screenStream, host: !!S.dirPeer }];
    S.peers.forEach(p => rows.push(p));
    rows.sort((a, b) => (b.hand ? 1 : 0) - (a.hand ? 1 : 0));
    $('#people').innerHTML = rows.map(r => `<li>
      <div class="avatar sm" style="background:${colorFor(r.name)}">${esc(initial(r.name))}</div>
      <div class="pname">${esc(r.name)}${r.host ? ' <small class="host-tag">Host</small>' : ''}${r.sharing ? ' <small>· presenting</small>' : ''}</div>
      <div class="icons">${r.hand ? `<span class="hand-on" title="Hand raised">${ico('hand')}</span>` : ''}
      <span class="${r.cam ? '' : 'off'}" title="${r.cam ? 'Camera on' : 'Camera off'}">${ico(r.cam ? 'video' : 'video-off')}</span>
      <span class="${r.mic ? '' : 'off'}" title="${r.mic ? 'Mic on' : 'Muted'}">${ico(r.mic ? 'mic' : 'mic-off')}</span></div></li>`).join('');
    icons();
    const n = rows.length; $('#badge-people').textContent = n; $('#people-count').textContent = n;
  }

  /* ---------- chat ---------- */
  function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'); }
  function scrollChat() { const l = $('#chat-list'); l.scrollTop = l.scrollHeight; }
  function addMsg(m) {
    if (!m.history) S.chat.push({ from: m.from, text: m.text, ts: m.ts });
    else S.chat.push({ from: m.from, text: m.text, ts: m.ts });
    $('#chat-empty').hidden = true;
    const el = document.createElement('div'); el.className = 'msg';
    el.innerHTML = `<div class="meta"><b>${esc(m.mine ? 'You' : m.from)}</b><span>${fmtTime(new Date(m.ts))}</span></div><div class="text">${linkify(m.text)}</div>`;
    $('#chat-list').appendChild(el); scrollChat();
    if (!m.mine && !m.history && S.panel !== 'chat') { $('#badge-chat').hidden = false; $('#badge-more').hidden = false; toast(`${m.from}: ${m.text.slice(0, 80)}`, 'message-square'); }
  }
  function addSys(text) {
    const el = document.createElement('div'); el.className = 'msg sys'; el.textContent = text;
    $('#chat-list').appendChild(el); scrollChat();
  }
  $('#chat-form').onsubmit = e => {
    e.preventDefault();
    const t = $('#chat-input').value.trim(); if (!t) return;
    const m = { t: 'chat', text: t, ts: Date.now() };
    broadcast(m); addMsg({ from: S.name, text: t, ts: m.ts, mine: true });
    $('#chat-input').value = '';
  };

  /* ---------- captions ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function toggleCC() {
    S.ccOn = !S.ccOn; syncControls();
    if (S.ccOn) {
      toast(SR ? 'Live captions on' : 'Captions on. Your browser can\'t transcribe you, but you\'ll see others.', 'captions');
      startRecognition();
    } else { stopRecognition(); $('#captions').innerHTML = ''; }
  }
  $('#ctl-cc').onclick = toggleCC;
  function startRecognition() {
    if (!SR || !S.ccOn || !S.micOn || S.rec) return;
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US';
    r.onresult = ev => {
      let text = '', final = false;
      for (let i = ev.resultIndex; i < ev.results.length; i++) { text += ev.results[i][0].transcript; if (ev.results[i].isFinal) final = true; }
      text = text.trim(); if (!text) return;
      showCaption('me', 'You', text, final); broadcast({ t: 'cap', text, final });
    };
    r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Speech recognition is blocked here', 'captions-off'); S.rec = null; } };
    r.onend = () => { if (S.rec === r) { S.rec = null; if (S.ccOn && S.micOn && S.inMeeting) setTimeout(startRecognition, 300); } };
    try { r.start(); S.rec = r; } catch {}
  }
  function stopRecognition() { const r = S.rec; S.rec = null; try { r && r.stop(); } catch {} }
  const capTimers = {};
  function showCaption(key, name, text, final) {
    if (!S.ccOn) return;
    let el = $(`[data-cap="${CSS.escape(key)}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'cap'; el.dataset.cap = key; $('#captions').appendChild(el); }
    el.innerHTML = `<b>${esc(name)}</b>${esc(text.length > 160 ? '…' + text.slice(-160) : text)}`;
    clearTimeout(capTimers[key]);
    capTimers[key] = setTimeout(() => el.remove(), final ? 4000 : 7000);
  }

  /* ---------- whiteboard ---------- */
  const cv = $('#board-canvas'), bctx = cv.getContext('2d');
  $('#swatches').innerHTML = BOARD_COLORS.map((c, i) => `<button style="background:${c}" data-c="${c}" class="${i === 0 ? 'active' : ''}" aria-label="Color ${c}"></button>`).join('');
  $('#swatches').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; S.brush.c = b.dataset.c; S.brush.e = false; $$('#swatches button').forEach(x => x.classList.toggle('active', x === b)); $('#board-eraser').classList.remove('active'); };
  $('#board-size').oninput = e => S.brush.w = +e.target.value;
  $('#board-eraser').onclick = () => { S.brush.e = !S.brush.e; $('#board-eraser').classList.toggle('active', S.brush.e); };
  $('#board-clear').onclick = () => { S.strokes = []; redrawBoard(); broadcast({ t: 'board-clear' }); };
  $('#board-close').onclick = toggleBoard;
  function toggleBoard() { S.boardOpen = !S.boardOpen; $('#board').hidden = !S.boardOpen; if (S.boardOpen) redrawBoard(); syncControls(); }
  $('#ctl-board').onclick = toggleBoard;
  function redrawBoard() { bctx.fillStyle = BOARD_BG; bctx.fillRect(0, 0, cv.width, cv.height); S.strokes.forEach(drawSeg); }
  function drawSeg(s) {
    bctx.strokeStyle = s.e ? BOARD_BG : s.c; bctx.lineWidth = s.e ? s.w * 4 : s.w; bctx.lineCap = 'round'; bctx.lineJoin = 'round';
    bctx.beginPath(); bctx.moveTo(s.a * cv.width, s.b * cv.height); bctx.lineTo(s.x * cv.width, s.y * cv.height); bctx.stroke();
  }
  function toBoard(e) {
    const r = cv.getBoundingClientRect(); const sc = Math.min(r.width / cv.width, r.height / cv.height);
    const ox = (r.width - cv.width * sc) / 2, oy = (r.height - cv.height * sc) / 2;
    return { x: (e.clientX - r.left - ox) / (cv.width * sc), y: (e.clientY - r.top - oy) / (cv.height * sc) };
  }
  let drawing = null, pending = [], flushT = 0;
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); drawing = toBoard(e); };
  cv.onpointermove = e => {
    if (!drawing) return;
    const p = toBoard(e);
    const s = { a: +drawing.x.toFixed(4), b: +drawing.y.toFixed(4), x: +p.x.toFixed(4), y: +p.y.toFixed(4), c: S.brush.c, w: S.brush.w, e: S.brush.e };
    S.strokes.push(s); drawSeg(s); pending.push(s); drawing = p;
    if (!flushT) flushT = setTimeout(() => { broadcast({ t: 'draw', s: pending }); pending = []; flushT = 0; }, 40);
  };
  cv.onpointerup = cv.onpointercancel = () => { drawing = null; };
  redrawBoard();

  /* ---------- leave ---------- */
  function teardown() {
    S.inMeeting = false;
    stopRecognition(); stopScreen();
    S.peers.forEach(p => [p.conn, p.call, p.screenCall, p.outScreen].forEach(c => { try { c && c.close(); } catch {} }));
    S.peers.clear(); S.roster.clear(); S.analysers.clear();
    endSession();
    S.waiting.clear(); S.allowed.clear(); S.pendingIn.forEach(q => clearTimeout(q.timer)); S.pendingIn.clear();
    $('#knocks').innerHTML = ''; renderWaiting();
    clearInterval(S.timerInt); clearInterval(speakerInt);
    $$('#stage .tile').forEach(t => t.remove());
    $('#chat-list').querySelectorAll('.msg').forEach(m => m.remove()); $('#chat-empty').hidden = false;
    $('#captions').innerHTML = ''; S.chat = []; S.strokes = []; redrawBoard();
    S.boardOpen = false; $('#board').hidden = true; S.ccOn = false; S.hand = false; S.pinned = null; closePanel();
  }
  $('#ctl-leave').onclick = () => {
    const mins = Math.max(1, Math.round((Date.now() - S.joinedAt) / 60000));
    teardown(); chime(false);
    S.camTrack?.stop(); S.camTrack = null; S.micTrack?.stop(); S.micTrack = null; S.camOn = true; S.micOn = true;
    $('#left-duration').textContent = `You were in ${S.room} for about ${mins} minute${mins === 1 ? '' : 's'}.`;
    show('left');
  };
  $('#btn-rejoin').onclick = () => enterLobby(S.room);
  $('#btn-home').onclick = goHome;
  function goHome() {
    if (S.inMeeting) teardown(); else if (S.session) endSession();
    setKnock(null);
    S.camTrack?.stop(); S.camTrack = null; S.micTrack?.stop(); S.micTrack = null; S.camOn = true; S.micOn = true;
    try { history.replaceState(null, '', location.pathname + location.search); } catch { try { location.hash = ''; } catch {} }
    document.title = 'Huddle — Video meetings with a link';
    show('home');
  }
  window.addEventListener('beforeunload', () => { try { S.dirPeer?.destroy(); S.peer?.destroy(); } catch {} });

  /* ---------- shortcuts ---------- */
  document.addEventListener('keydown', e => {
    if (!S.inMeeting) return;
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && !e.altKey && k === 'd') { e.preventDefault(); toggleMic(); }
    else if (mod && !e.altKey && k === 'e') { e.preventDefault(); toggleCam(); }
    else if (mod && e.altKey && k === 'h') { e.preventDefault(); toggleHand(); }
    else if (mod && e.altKey && k === 'c') { e.preventDefault(); openPanel('chat'); }
    else if (k === 'escape') { $('#modal-devices').hidden = true; $('#modal-invite').hidden = true; rp.hidden = true; $('#more-pop').hidden = true; }
  });

  /* ---------- boot ---------- */
  icons();
  const initCode = parseCode(location.hash);
  if (initCode) enterLobby(initCode); else show('home');
  window.addEventListener('hashchange', () => { const c = parseCode(location.hash); if (c && !S.inMeeting && c !== S.room) enterLobby(c); });
  window.__huddle = S;
})();
