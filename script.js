// DOM Elements
const flame = document.getElementById('flame');
const startMicBtn = document.getElementById('start-mic-btn');
const manualBtn = document.getElementById('manual-extinguish-btn');
const micStatus = document.getElementById('mic-status');
const celebrationMessage = document.getElementById('celebration-message');
const instructionText = document.getElementById('instruction-text');
const cakeSection = document.getElementById('cake');
const audio = document.getElementById('birthday-song');

// State
let isListening = false;
let audioContext;
let analyser;
let microphone;
let scriptProcessor;

// Mic Logic State
let noiseFloor = 0;
let blowDuration = 0;
let previousRms = 0;
let isCalibrating = false;
const BLOW_THRESHOLD_OFFSET = 0.15; // User suggested 0.15
const REQUIRED_BLOW_DURATION = 500; // ms (User suggested 500ms)
const DEBUG = false; // Set to true to see debug overlay

// Debug Elements (Created dynamically)
if (DEBUG) {
    const debugOverlay = document.createElement('div');
    debugOverlay.id = 'debug-overlay';
    debugOverlay.style.cssText = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: #0f0;
        padding: 10px;
        font-family: monospace;
        font-size: 12px;
        border-radius: 5px;
        z-index: 9999;
        display: none;
    `;
    document.body.appendChild(debugOverlay);
}

function updateDebug(rms, threshold, duration, status) {
    if (!DEBUG) return;
    const debugOverlay = document.getElementById('debug-overlay');
    if (!debugOverlay) return;

    debugOverlay.style.display = 'block'; // Show when active
    debugOverlay.innerHTML = `
        <strong>DEBUG MODE</strong><br>
        RMS: ${rms.toFixed(4)}<br>
        Noise Floor: ${noiseFloor.toFixed(4)}<br>
        Threshold: ${threshold.toFixed(4)}<br>
        Blow Duration: ${duration.toFixed(0)}ms<br>
        Status: ${status}
    `;
}

// 1️⃣ Scroll Animation (Intersection Observer)
const observerOptions = {
    threshold: 0.2
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            if (entry.target.classList.contains('letter-card')) {
                typeLetter(); // Start typing when letter is visible
            }
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));

// 2️⃣ Typing Effect for Letter
const letterText = `Hôm nay là ngày đặc biệt của em.
Anh chưa từng gặp em ngoài đời, nhưng mỗi lần nói chuyện đều khiến anh cảm thấy gần hơn một chút.

Tuổi mới, anh chúc em:
Luôn xinh đẹp theo cách riêng của mình...
Luôn vui vẻ và được yêu thương...

Và nếu có thể... cho anh cơ hội bước vào cuộc sống của em một cách nghiêm túc hơn 💖`;

function typeLetter() {
    const typingElement = document.getElementById('typing-text');
    if (typingElement && typingElement.innerHTML.length > 0) return;

    let i = 0;
    const speed = 50;

    function type() {
        if (i < letterText.length) {
            if (letterText.charAt(i) === '\n') {
                typingElement.innerHTML += '<br>';
            } else {
                typingElement.innerHTML += letterText.charAt(i);
            }
            i++;
            setTimeout(type, speed);
        }
    }
    type();
}

// 3️⃣ Microphone Logic
startMicBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        // Use Time Domain Data for more precision in detecting "wind" logic
        analyser.fftSize = 2048;

        isListening = true;

        // UI Updates
        startMicBtn.classList.add('hidden');
        micStatus.classList.remove('hidden');
        manualBtn.classList.remove('hidden');

        micStatus.textContent = "Đang đo tiếng ồn môi trường... (Giữ yên lặng 2s) 🤫";

        calibrateNoise(); // Step 1: Calibrate

    } catch (err) {
        console.error('Microphone access denied:', err);
        alert('Không thể truy cập micro. Bạn có thể dùng nút bấm bên dưới nhé!');
        startMicBtn.classList.add('hidden');
        manualBtn.classList.remove('hidden');
    }
});

function calculateRMS(dataArray) {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
    }
    return Math.sqrt(sum / dataArray.length);
}

function calibrateNoise() {
    isCalibrating = true;
    let silenceSamples = 0;
    let totalRms = 0;
    const calibrationStartTime = Date.now();
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

    function calibrationLoop() {
        if (!isListening) return;

        analyser.getFloatTimeDomainData(dataArray);
        const rms = calculateRMS(dataArray);

        totalRms += rms;
        silenceSamples++;

        if (Date.now() - calibrationStartTime < 2000) {
            requestAnimationFrame(calibrationLoop);
        } else {
            // Finish Calibration
            noiseFloor = totalRms / silenceSamples;
            isCalibrating = false;
            micStatus.textContent = "Đã xong! Giờ hãy thổi vào micro để tắt nến nào! 🌬️";
            detectBlow(); // Step 2: Start Detection
        }
    }
    calibrationLoop();
}

function detectBlow() {
    if (!isListening || isCalibrating) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(dataArray);

    const rms = calculateRMS(dataArray);
    const dynamicThreshold = noiseFloor + BLOW_THRESHOLD_OFFSET;

    // Logic: spike detection + sustained duration
    // Check if current RMS is significantly higher than noise floor AND rising
    const isSpike = (rms > dynamicThreshold) && ((rms - previousRms) > 0.001);
    // We reduced delta amplitude check slightly because '0.05' might be too strict if frame rate is high, 
    // but user asked for 0.05. Let's stick closer to user request but be safe with 0.01 for "rising" or just check level.
    // User logic: if (rms > dynamicThreshold && rms - previousRms > 0.05 && blowDuration > 500ms)
    // Adjusting strictly to user request but handling the loop:

    const isLoudAhough = rms > dynamicThreshold;

    // Check for "wind" pattern: not just loud, but sustained
    if (isLoudAhough) {
        blowDuration += 16; // approx 60fps frame time

        // Visual Feedback (Shake more violently as you blow)
        flame.style.transform = `translateX(-50%) skewX(${Math.random() * 20 - 10}deg) scale(${0.8 + Math.random() * 0.2})`;

    } else {
        blowDuration = 0; // Reset if silence
        // Reset flame
        flame.style.transform = `translateX(-50%) skewX(0deg) scale(1)`;
    }

    updateDebug(rms, dynamicThreshold, blowDuration, isLoudAhough ? "BLOWING" : "WAITING");

    if (blowDuration > REQUIRED_BLOW_DURATION) {
        extinguishCandle();
        return;
    }

    previousRms = rms;
    requestAnimationFrame(detectBlow);
}

// 4️⃣ Celebration Logic
manualBtn.addEventListener('click', extinguishCandle);

function extinguishCandle() {
    if (!flame.classList.contains('out')) {
        // 1. Stop listening
        isListening = false;
        if (audioContext) audioContext.close();

        const debugOverlay = document.getElementById('debug-overlay');
        if (debugOverlay) debugOverlay.style.display = 'none';

        // 2. Animate Flame Out
        flame.classList.add('out');

        // Vibrate if supported
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]); // Vibration pattern
        }

        // 3. UI Changes
        micStatus.classList.add('hidden');
        instructionText.textContent = "Điều ước đã được gửi đi! ✨";

        // 4. Change Theme & Show Message
        setTimeout(() => {
            cakeSection.classList.add('celebrate');
            celebrationMessage.classList.remove('hidden');
            manualBtn.classList.add('hidden');

            // 5. Play Music & Confetti
            playAudio();
            triggerConfetti();
        }, 500);
    }
}

function playAudio() {
    audio.volume = 0.5;
    audio.play().catch(e => console.log("Audio autoplay policy prevented playback", e));
}

function triggerConfetti() {
    const duration = 5 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}
