let model = null;
let faceModel = null;
let running = false;
let soundOn = true;
let lastBeep = 0;
let frames = 0;
let fpsMark = 0;
let counts = { total: 0, ok: 0, bad: 0 };
let logRows = 0;
let verdict = { name: null, pct: 0, pass: null };
let prevClasses = [];

const $ = (id) => document.getElementById(id);
const video = $('video');
const viewport = $('viewport');
const btnStart = $('btnStart');
const btnStop = $('btnStop');
const btnSound = $('btnSound');
const btnClear = $('btnClear');
const autoSound = $('autoSound');
const modelStatus = $('modelStatus');
const modelTag = $('modelTag');
const camTag = $('camTag');
const hudName = $('hudName');
const hudPct = $('hudPct');
const scanline = $('scanline');
const banner = $('resultBanner');
const resultIcon = $('resultIcon');
const resultTitle = $('resultTitle');
const resultDesc = $('resultDesc');
const predictionsBox = $('predictions');
const classList = $('classList');
const logBody = $('logBody');
const logEmpty = $('logEmpty');
const viewportEl = $('viewport');
const canvas = $('hitbox');
const ctx = canvas.getContext('2d');

// detector de rostro para la hitbox
async function loadFace() {
    try {
        faceModel = await blazeface.load();
    } catch (err) {
        console.error('detector de rostro no cargó', err);
    }
}

function drawHitbox(faces) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const cw = canvas.width = viewportEl.clientWidth;
    const ch = canvas.height = viewportEl.clientHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * scale) / 2;
    const oy = (ch - vh * scale) / 2;

    ctx.clearRect(0, 0, cw, ch);

    faces.forEach((f, i) => {
        const v = f.verdict;
        const color = !v ? '#1d3bdf' : v.pass ? '#3ddc7c' : '#ff5f52';

        let x = ox + f.topLeft[0] * scale;
        let y = oy + f.topLeft[1] * scale;
        let w = (f.bottomRight[0] - f.topLeft[0]) * scale;
        let h = (f.bottomRight[1] - f.topLeft[1]) * scale;

        // extiende la caja hacia arriba donde va el casco
        const up = h * 0.85;
        y -= up; h += up;
        const pad = w * 0.18;
        x -= pad; w += pad * 2;

        // el video está espejado, la caja también
        x = cw - x - w;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // esquinas tipo ESP de cheat
        const t = 16;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, y + t); ctx.lineTo(x, y); ctx.lineTo(x + t, y);
        ctx.moveTo(x + w - t, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + t);
        ctx.moveTo(x, y + h - t); ctx.lineTo(x, y + h); ctx.lineTo(x + t, y + h);
        ctx.moveTo(x + w - t, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - t);
        ctx.stroke();

        if (v) {
            const label = v.name + '  ' + v.pct + '%';
            ctx.font = 'bold 13px Consolas, monospace';
            const tw = ctx.measureText(label).width;
            const ly = Math.max(y - 24, 2);
            ctx.fillStyle = 'rgba(0,0,0,.82)';
            ctx.fillRect(x, ly, tw + 16, 21);
            ctx.fillStyle = color;
            ctx.fillText(label, x + 8, ly + 15);
        }
    });
}

// recorta la zona de la cabeza desde el video sin espejar
function cropHead(f) {
    const vw = video.videoWidth, vh = video.videoHeight;
    let x = f.topLeft[0], y = f.topLeft[1];
    let w = f.bottomRight[0] - f.topLeft[0];
    let h = f.bottomRight[1] - f.topLeft[1];

    y -= h * 0.85; h += h * 0.85;
    const pad = w * 0.35;
    x -= pad; w += pad * 2;

    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(w, vw - x); h = Math.min(h, vh - y);

    const c = document.createElement('canvas');
    c.width = 224; c.height = 224;
    c.getContext('2d').drawImage(video, x, y, w, h, 0, 0, 224, 224);
    return c;
}

// clasifica a cada rostro por separado
async function classifyFaces(faces) {
    for (let i = 0; i < faces.length; i++) {
        try {
            const out = await model.predict(cropHead(faces[i]));
            let top = out[0];
            for (const p of out) if (p.probability > top.probability) top = p;
            faces[i].verdict = {
                name: top.className,
                pct: Math.round(top.probability * 100),
                pass: isSafe(top.className),
                preds: out
            };
        } catch (e) {
            console.error('clasificación fallida', e);
        }
    }
    return faces;
}

// veredicto general: falla si alguien no lleva casco
function overallVerdict(faces) {
    if (!faces.length) return { name: null, pct: 0, pass: null };

    const bad = faces.filter(f => f.verdict && !f.verdict.pass);
    const primary = faces[0].verdict;

    if (bad.length) {
        return {
            name: bad[0].verdict.name,
            pct: bad[0].verdict.pct,
            pass: false,
            extra: faces.length > 1 ? bad.length + ' de ' + faces.length + ' sin casco' : null
        };
    }
    return { name: primary.name, pct: primary.pct, pass: true, extra: null };
}

// carga el modelo al abrir la página
async function loadModel() {
    try {
        model = await window.tmImage.load(
            'models/mi-modelo/model.json',
            'models/mi-modelo/metadata.json'
        );
        const labels = model.getClassLabels();
        classList.innerHTML = labels.map(l => `<span class="chip">${l}</span>`).join('');
        modelStatus.dataset.state = 'on';
        modelStatus.querySelector('.lamp-txt').textContent = 'modelo cargado';
        modelTag.textContent = 'listo';
        btnStart.disabled = false;
        $('loadModelMsg').hidden = true;
        $('modelOk').hidden = false;
    } catch (err) {
        console.error(err);
        modelStatus.dataset.state = 'err';
        modelStatus.querySelector('.lamp-txt').textContent = 'error al cargar';
        modelTag.textContent = 'error';
        $('loadModelMsg').innerHTML = '<span>No se pudo cargar el modelo. Revise que exista la carpeta models/mi-modelo/</span>';
    }
}

btnStart.addEventListener('click', async () => {
    if (!model) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: false
        });
        video.srcObject = stream;
        await video.play();
        running = true;
        btnStart.disabled = true;
        btnStop.disabled = false;
        camTag.textContent = 'en vivo';
        scanline.hidden = false;
        frames = 0;
        fpsMark = performance.now();
        loop();
    } catch (err) {
        alert('No se pudo abrir la cámara: ' + err.message);
    }
});

btnStop.addEventListener('click', () => {
    running = false;
    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    btnStart.disabled = false;
    btnStop.disabled = true;
    camTag.textContent = 'detenida';
    scanline.hidden = true;
    viewport.className = 'viewport';
    hudName.textContent = 'SIN SEÑAL';
    hudPct.textContent = '';
    verdict = { name: null, pct: 0, pass: null };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    btnSound.innerHTML = soundOn
        ? '<i class="fas fa-volume-up"></i> Sonido activo'
        : '<i class="fas fa-volume-mute"></i> Sonido silenciado';
});

btnClear.addEventListener('click', () => {
    logBody.innerHTML = '';
    logRows = 0;
    logEmpty.hidden = false;
    counts = { total: 0, ok: 0, bad: 0 };
    $('statTotal').textContent = '0';
    $('statOk').textContent = '0';
    $('statBad').textContent = '0';
});

async function loop() {
    while (running) {
        if (video.readyState >= 2 && model && faceModel) {
            try {
                let faces = await faceModel.estimateFaces(video, false);
                faces = await classifyFaces(faces);

                drawHitbox(faces);
                const v = overallVerdict(faces);
                if (v.name) showVerdict(v, faces);
                trackChanges(faces);

                frames++;
                const now = performance.now();
                if (now - fpsMark >= 1000) {
                    $('statFps').textContent = frames;
                    frames = 0;
                    fpsMark = now;
                }
            } catch (e) {
                console.error('detección fallida', e);
            }
        }
        await new Promise(r => setTimeout(r, 300));
    }
}

// cuenta cambios por persona para las estadísticas
function trackChanges(faces) {
    const classes = faces.map(f => f.verdict ? f.verdict.name : null);

    classes.forEach((cls, i) => {
        if (cls && prevClasses[i] !== cls) {
            const v = faces[i].verdict;
            counts.total++;
            v.pass ? counts.ok++ : counts.bad++;
            $('statTotal').textContent = counts.total;
            $('statOk').textContent = counts.ok;
            $('statBad').textContent = counts.bad;
            addLog(v.name, v.pct, v.pass);
        }
    });
    prevClasses = classes;
}

// muestra el veredicto general en el panel
function showVerdict(v, faces) {
    verdict = v;

    hudName.textContent = v.name;
    hudPct.textContent = v.pct + '%';

    banner.dataset.state = v.pass ? 'pass' : 'fail';
    resultIcon.innerHTML = v.pass
        ? '<i class="fas fa-check"></i>'
        : '<i class="fas fa-times"></i>';
    resultTitle.textContent = v.pass ? 'Casco correctamente puesto' : 'Casco ausente o incorrecto';
    resultDesc.textContent = v.extra
        ? v.extra
        : 'Clase detectada: ' + v.name + ' · confianza ' + v.pct + '%';

    viewport.className = 'viewport ' + (v.pass ? 'pass' : 'alarm');

    // barras de la primera persona detectada
    const primary = faces.find(f => f.verdict && f.verdict.preds);
    if (primary) {
        const out = primary.verdict.preds;
        const topName = primary.verdict.name;
        predictionsBox.innerHTML = out.map(p => {
            const val = Math.round(p.probability * 100);
            const cls = p.className === topName ? (primary.verdict.pass ? 'ok' : 'bad') : '';
            return `<div class="bar-row">
                <span class="bar-name">${p.className}</span>
                <span class="bar-track"><span class="bar-fill ${cls}" style="width:${val}%"></span></span>
                <span class="bar-pct">${val}%</span>
            </div>`;
        }).join('');
    }

    const now = Date.now();
    if (soundOn && autoSound.checked && now - lastBeep > 1500) {
        v.pass ? tone(880, 160) : alarm();
        lastBeep = now;
    }
}

// las clases con "sin" o "no" se consideran incumplimiento
function isSafe(name) {
    const n = name.toLowerCase();
    if (n.includes('sin ') || n.includes('sin-') || n.includes('no ') || n.includes('no-')) return false;
    return true;
}

let actx = null;
function tone(freq, ms, delay = 0) {
    try {
        if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.connect(g); g.connect(actx.destination);
        o.frequency.value = freq;
        o.type = 'square';
        g.gain.setValueAtTime(0.0001, actx.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.18, actx.currentTime + delay + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + delay + ms / 1000);
        o.start(actx.currentTime + delay);
        o.stop(actx.currentTime + delay + ms / 1000 + 0.05);
    } catch (e) { console.warn('audio', e); }
}

function alarm() {
    tone(420, 220);
    tone(420, 220, 0.3);
    tone(420, 220, 0.6);
}

function addLog(name, pct, pass) {
    logRows++;
    logEmpty.hidden = true;
    const hora = new Date().toLocaleTimeString();
    const row = document.createElement('tr');
    row.innerHTML = `<td>${hora}</td><td>${name}</td>
        <td class="${pass ? 'tag-ok' : 'tag-bad'}">${pct}% ${pass ? 'OK' : 'FALLA'}</td>`;
    logBody.prepend(row);
    while (logBody.children.length > 12) logBody.removeChild(logBody.lastChild);
}

loadModel();
loadFace();
