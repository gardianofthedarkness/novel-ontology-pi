import test from 'node:test';
import assert from 'node:assert/strict';
import { daypartOfHour, storySky, weatherWords } from './sky.mjs';

const SNOWING = '\u4e0b\u96ea', LYING = '\u79ef\u96ea', CLEAR = '\u84dd\u5929', STORM = '\u6253\u96f7', SIMILE = '\u98ce\u96e8\u4e2d\u7684\u5c0f\u8239', GLOOMY = '\u9634\u6c89\u7684\u8868\u60c5';

test('weather words: what they say, storms and snow over clear; figures of speech are no weather', () => {
  assert.equal(weatherWords(`${CLEAR}${SNOWING}`).top, 'snow');
  assert.equal(weatherWords(LYING).lying, true);
  assert.equal(weatherWords(SIMILE).top, null, 'a boat in wind and rain is no rain');
  assert.equal(weatherWords(GLOOMY).top, null, 'a gloomy face is no overcast sky');
  assert.equal(daypartOfHour(2), 'late night'); assert.equal(daypartOfHour(10.75), 'morning'); assert.equal(daypartOfHour(19), 'evening');
});

test('the sky carried on within a date: settled weather all day, a passing storm only in its sequence; the hour between parts; smoothing', () => {
  const unit = (id, sequence, node, inherited = true) => ({ id, sequence, sentences: [`${id}_s`] });
  const scenes = [unit('u1', 'q1'), unit('u2', 'q1'), unit('u3', 'q2'), unit('u4', 'q3'), unit('u5', 'q3'), unit('u6', 'q4')];
  const words = { u1_s: SNOWING, u3_s: STORM };
  const time = { scenes: [
    { scene: 'u1', node: 't:y1:12-24:late-night', inherited: false }, { scene: 'u2', node: 't:y1:12-24:late-night', inherited: true },
    { scene: 'u3', node: 't:y1:12-24', inherited: true }, { scene: 'u4', node: 't:y1:12-24', inherited: true },
    { scene: 'u5', node: 't:y1:12-24:evening', inherited: false }, { scene: 'u6', node: 't:y1:12-25:morning', inherited: false },
  ] };
  const sky = storySky({ reading: { scenes, time, sequences: [] }, text: id => words[id] ?? '' });
  assert.deepEqual(['u1', 'u2', 'u3', 'u4', 'u5'].map(id => sky[id].weather.value), ['snow', 'snow', 'storm', 'snow', 'snow'], 'the storm passes with its sequence; the snow comes back');
  assert.equal(sky.u6.weather.value, 'unknown', 'a new date starts afresh');
  assert.ok(sky.u2.lying && sky.u5.lying, 'snow once fallen lies for the day');
  assert.equal(sky.u3.daypart.by, 'between'); assert.equal(sky.u3.daypart.value, 'morning', 'between the late night and the evening of the 24th');
  assert.equal(sky.u1.daypart.by, 'time words'); assert.equal(sky.u2.daypart.by, 'period');
});
