const clips = ["wind", "crickets", "bird", "bee"];

export class ForestAudio {
  constructor() {
    this.enabled = false;
    this.buffers = {};
    this.loops = {};
    this.nextCall = { bird: 0, bee: 0 };
    this.nextMix = 0;
  }

  async setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      await this.context?.suspend();
      return;
    }
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.context.destination);
      }
      await this.context.resume();
      this.loading ??= Promise.all(clips.map(async name => {
        const url = window.POCKET_FOREST_AUDIO?.[name] ?? `audio/${name}.mp3`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load ${name}`);
        this.buffers[name] = await this.context.decodeAudioData(await response.arrayBuffer());
      }));
      await this.loading;
      if (!this.loops.wind) {
        this.loops.wind = this.play("wind", { loop: true, level: 0.18 });
        this.loops.crickets = this.play("crickets", { loop: true, level: 0 });
      }
    } catch (error) {
      this.loading = null;
      this.enabled = false;
      await this.context?.suspend();
      throw error;
    }
  }

  play(name, { loop = false, pan = 0, level, rate = 1 }) {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffers[name];
    source.loop = loop;
    source.playbackRate.value = rate;
    gain.gain.value = level;
    source.connect(gain);
    if (loop) gain.connect(this.master);
    else {
      const panner = this.context.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.master);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        panner.disconnect();
      };
    }
    source.start();
    return gain.gain;
  }

  update(view, state, time) {
    if (!this.enabled || !this.loops.wind || time < this.nextMix) return;
    this.nextMix = time + 0.25;
    let habitat = 0;
    const species = new Set();
    for (const plant of state.plants) {
      if (!plant.planted || plant.health <= 40) continue;
      habitat += Math.min(1, plant.age / 2.5) * plant.health / 100;
      species.add(plant.sid);
    }
    const diversity = Math.min(1, habitat / 6) * Math.min(1, species.size / 3);
    const warm = state.day % 365 >= 55 && state.day % 365 < 260;
    const now = this.context.currentTime;
    this.loops.wind.setTargetAtTime(0.15 + Math.abs(view.wind) * 3, now, 0.5);
    this.loops.crickets.setTargetAtTime((warm ? 0.16 : 0.025) * diversity, now, 1.2);
    for (const [name, creatures] of [["bird", view.birds], ["bee", view.insects.slice(0, 7)]]) {
      if (time < this.nextCall[name]) continue;
      const visible = [];
      for (const { g } of creatures) {
        if (!g.visible) continue;
        const point = view.project(g.position.x, g.position.y, g.position.z);
        if (point.x > 0 && point.x < innerWidth && point.y > 0 && point.y < innerHeight)
          visible.push(point.x);
      }
      if (!visible.length) {
        this.nextCall[name] = time + 1;
        continue;
      }
      const x = visible[Math.floor(Math.random() * visible.length)];
      this.play(name, {
        pan: (x / innerWidth - 0.5) * 1.4,
        level: (name === "bird" ? 0.30 : 0.11) * (0.65 + diversity * 0.35),
        rate: 0.88 + Math.random() * 0.24,
      });
      this.nextCall[name] = time + (name === "bird" ? 7 : 10) + Math.random() * 6 - diversity * 4;
    }
  }
}
