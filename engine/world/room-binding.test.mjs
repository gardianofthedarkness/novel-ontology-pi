// One room, one place in the world: each room place bound once to one plan room of its building's lot, kept between runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindRooms, partOf, roomsOf, storyHints } from './room-binding.mjs';

const script = {
  places: { city: { label: 'city', scale: 'city' }, dorm: { label: 'dorm', scale: 'building', parent: 'city' }, room: { label: 'his room', scale: 'room', parent: 'dorm' }, hall: { label: 'entrance', scale: 'room', parent: 'room' }, lost: { label: 'a room', scale: 'room', parent: 'city' } },
  scenes: [{ id: 'u1', place: 'room' }, { id: 'u2', place: 'hall' }, { id: 'u3', place: 'room' }, { id: 'u4', place: 'lost' }, { id: 'u5', place: 'city' }],
};
const lot = { index: 7, place: 'dorm', floors: 3, rooms: [{ floor: 0, i0: 0, j0: 0, i1: 5, j1: 5 }, { floor: 1, i0: 0, j0: 0, i1: 1, j1: 1 }, { floor: 1, i0: 2, j0: 0, i1: 4, j1: 1 }, { floor: 1, i0: 0, j0: 2, i1: 5, j1: 5, kind: 'hall' }] };
const lotsOf = building => (building === 'dorm' ? lot : null);

test('the rooms a run needs, each with its building and the room it lies in', () => {
  assert.deepEqual(roomsOf(script).map(room => [room.id, room.building, room.within]), [['room', 'dorm', null], ['hall', 'dorm', 'room'], ['lost', null, null]]);
});

test('bound upstairs to the room nearest a single room\'s size; an entrance beside it on its floor; no building is a problem', () => {
  const { rooms, problems } = bindRooms(roomsOf(script), lotsOf);
  assert.deepEqual([rooms.room.lot, rooms.room.room, rooms.room.floor], [7, 1, 1], 'floor 1, the 2 x 2 room, not the ground floor\'s big one nor the hall');
  assert.deepEqual([rooms.hall.lot, rooms.hall.floor, rooms.hall.room], [7, 1, 2]);
  assert.deepEqual(problems.map(entry => entry.place), ['lost']);
});

test('the binding kept from the last run stands while its lot and room do', () => {
  const kept = { room: { lot: 3, lotPlace: 'dorm', room: 2, floor: 1, building: 'dorm' } };
  assert.equal(bindRooms(roomsOf(script), lotsOf, kept).rooms.room.room, 2, 'kept (the lot index refreshed)');
  assert.equal(bindRooms(roomsOf(script), lotsOf, { room: { ...kept.room, room: 3 } }).rooms.room.room, 1, 'a hall is not a room to keep');
});

test('the agent\'s room plan: its floor as the text counts it, a part bound inside its room; else a stated floor; nothing from names', () => {
  const tall = { index: 2, place: 'dorm', floors: 7, rooms: [1, 2, 3, 4, 5, 6].flatMap(floor => [{ floor, i0: 0, j0: 0, i1: 1, j1: 1 }, { floor, i0: 2, j0: 0, i1: 3, j1: 1 }]) };
  const rooms = () => [{ id: 'room', label: 'his room', building: 'dorm', within: null, kind: 'bedroom' }, { id: 'door', label: 'the entrance', building: 'dorm', within: null, kind: 'lobby or hall' }];
  const plan = { rooms: { room: { floor: { value: 7 } }, door: { part: { of: 'room' } } } };
  const planned = storyHints(rooms(), () => [], plan);
  assert.equal(planned[0].floor, 6, 'the seventh floor is plan floor 6');
  assert.deepEqual([planned[1].within, planned[1].entry], ['room', true]);
  const kept = { room: { lot: 2, lotPlace: 'dorm', room: 0, floor: 1, building: 'dorm', kind: 'bedroom' }, door: { lot: 2, lotPlace: 'dorm', room: 1, floor: 1, building: 'dorm' } };
  const { rooms: bound } = bindRooms(planned, () => tall, kept);
  assert.equal(bound.room.floor, 6, 'a kept binding on another floor is bound again');
  assert.deepEqual([bound.door.room, bound.door.floor, bound.door.entry], [bound.room.room, 6, true], 'the part is the room itself');
  const unplanned = storyHints(rooms(), id => (id === 'room' ? [{ kind: 'floor', value: 3, basis: 'stated', sure: 0.9 }] : []));
  assert.deepEqual([unplanned[0].floor, unplanned[1].within ?? null], [2, null], 'a stated floor without a plan; an entrance by its name alone is nothing');
});

test('a room one cell wide is the last choice: a 2 x 3 room before a 1 x 4 strip of the very area', () => {
  const strip = { index: 1, place: 'dorm', floors: 2, rooms: [{ floor: 1, i0: 0, j0: 0, i1: 0, j1: 3 }, { floor: 1, i0: 2, j0: 0, i1: 3, j1: 2 }] };
  const { rooms } = bindRooms([{ id: 'room', label: 'his room', building: 'dorm', within: null, kind: 'bedroom' }], () => strip);
  assert.equal(rooms.room.room, 1, 'the 2 x 3 room, though the strip is a bedroom\'s very area');
  const again = bindRooms([{ id: 'room', label: 'his room', building: 'dorm', within: null, kind: 'bedroom' }], () => strip, { room: { lot: 1, lotPlace: 'dorm', room: 0, floor: 1, building: 'dorm', kind: 'bedroom' } });
  assert.equal(again.rooms.room.room, 1, 'a kept strip is bound again');
});

test('a plan room much bigger than its kind is bound as a room-sized part along its outer wall', () => {
  const room = { i0: 0, j0: 3, i1: 3, j1: 5 }, outer = (i, j) => j > 5;
  assert.deepEqual(partOf(room, 'bedroom', outer), [0, 4, 2, 5], '3 cells along the outer side j = 5, 2 deep');
  assert.equal(partOf({ i0: 0, j0: 0, i1: 1, j1: 1 }, 'bedroom', outer), null, 'a 2 x 2 room is a bedroom\'s size already');
  assert.equal(partOf(room, 'bedroom', () => false), null, 'no outer wall: no part');
});

test('a room that takes the sun is bound to a plan room whose outer wall faces it, over an equal one', () => {
  const lot = { index: 4, place: 'dorm', floors: 3, rooms: [{ floor: 2, i0: 0, j0: 0, i1: 1, j1: 1 }, { floor: 2, i0: 4, j0: 0, i1: 5, j1: 1 }] };
  const sunScore = (lotIndex, entry) => (entry.i0 === 4 ? 1 : -1);
  const rooms = [{ id: 'room', label: 'his room', building: 'dorm', within: null, kind: 'bedroom', sunScore }];
  assert.equal(bindRooms(rooms, () => lot).rooms.room.room, 1, 'the sunny one');
  assert.equal(bindRooms([{ ...rooms[0], sunScore: (l, e) => -sunScore(l, e) }], () => lot).rooms.room.room, 0, 'and the other way round');
});
