import test from "node:test";
import assert from "node:assert/strict";
import { ForestAudio } from "../dist/forest-audio.js";

test("mute takes effect during the first load and unmute reuses the playing wind", async (t) => {
  let finishWind;
  const wind = new Promise(resolve => { finishWind = resolve; });
  const clips = [];
  class AudioContext {
    state = "running";
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    decodeAudioData(data) { return Promise.resolve(data); }
  }
  t.mock.method(globalThis, "fetch", async url => ({
    ok: true,
    arrayBuffer: () => url.endsWith("wind.mp3") ? wind : new ArrayBuffer(0),
  }));
  globalThis.window = { AudioContext };
  t.after(() => { delete globalThis.window; });
  const audio = new ForestAudio();
  audio.play = (name, options) => {
    clips.push({ name, options });
    return {};
  };

  const starting = audio.setEnabled(true);
  assert.equal(audio.enabled, true);
  assert.equal(audio.master.gain.value, 0.55);
  await audio.setEnabled(false);
  assert.equal(audio.master.gain.value, 0);
  finishWind(new ArrayBuffer(1));
  await starting;
  assert.equal(audio.enabled, false);
  assert.equal(audio.master.gain.value, 0);
  assert.equal(clips[0].name, "wind");
  assert.ok(clips[0].options.level > 1);

  const enablingAgain = audio.setEnabled(true);
  assert.equal(audio.master.gain.value, 0.55);
  await enablingAgain;
  assert.equal(clips.filter(clip => clip.name === "wind").length, 1);
});
