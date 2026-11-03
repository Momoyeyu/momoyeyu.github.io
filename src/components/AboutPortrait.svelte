<script lang="ts">
    import { onDestroy } from "svelte";

    let mode = 0;
    let audio: AudioContext | undefined;
    onDestroy(() => { void audio?.close(); });

    async function squeeze() {
        mode = (mode + 1) % 3;
        if (!window.AudioContext) return;
        audio ??= new AudioContext();
        await audio.resume().catch(() => {});
        if (audio.state !== "running") return;

        const now = audio.currentTime;
        const reed = audio.createOscillator();
        const body = audio.createBiquadFilter();
        const volume = audio.createGain();
        reed.type = "sawtooth";
        reed.frequency.setValueAtTime(670, now);
        reed.frequency.exponentialRampToValueAtTime(1120, now + .06);
        reed.frequency.exponentialRampToValueAtTime(490, now + .22);
        body.type = "bandpass";
        body.frequency.value = 1600;
        body.Q.value = 1.4;
        volume.gain.setValueAtTime(.001, now);
        volume.gain.exponentialRampToValueAtTime(.15, now + .02);
        volume.gain.exponentialRampToValueAtTime(.001, now + .23);
        reed.connect(body).connect(volume).connect(audio.destination);
        reed.start(now);
        reed.stop(now + .24);
        reed.onended = () => { reed.disconnect(); body.disconnect(); volume.disconnect(); };
    }
</script>
<div class="portrait-stage">
    <button class="plinth" type="button" data-mode={mode} aria-label="墨末夜羽的头像，点击切换转法" onclick={squeeze}>
        <span class="portrait"><img src="/img/resources/avatar.jpg" alt="" width="100" height="100" /></span>
    </button>
</div>
<style>
    .portrait-stage { display: grid; justify-items: center; padding: 2rem 0 3rem; gap: 1.5rem; }
    .plinth { perspective: 500px; display: grid; place-items: center; width: 140px; height: 140px; }
    .portrait { width: 136px; height: 136px; border-radius: 50%; display: grid; place-items: center;
        background: repeating-radial-gradient(circle, #202124 0 1px, #343537 2px, #17181a 3px);
        animation: vinyl 14s linear infinite; }
    .portrait img { width: 72%; height: 72%; object-fit: cover; border-radius: 50%; }
    [data-mode="1"] .portrait { background: #91a5b3; animation: coin 3.8s linear infinite; }
    [data-mode="2"] .portrait { background: transparent; animation: top 2s linear infinite; }
    .plinth:not([data-mode="0"]) img { width: 96%; height: 96%; }
    @keyframes vinyl { to { transform: rotate(1turn); } }
    @keyframes coin { to { transform: rotateY(1turn); } }
    @keyframes top { from { transform: rotate(-12deg) rotateX(48deg) rotate(0turn); } to { transform: rotate(-12deg) rotateX(48deg) rotate(1turn); } }
    @media (prefers-reduced-motion: reduce) { .portrait-stage .plinth .portrait { animation: none !important; } }
    button { cursor: pointer; border-radius: 50%; }
</style>
