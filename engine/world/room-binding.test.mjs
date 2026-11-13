// One room, one place in the world: each room place bound once to one plan room of its building's lot, kept between runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindRooms, roomsOf } from './room-binding.mjs';

const script = {
  places: { city: { label: 'city', scale: 'city' }, dorm: { label: 'dorm', scale: 'building', parent: 'city' }, room: { label: 'his room', scale: 'room', parent: 'dorm' }, hall: { label: 'entrance', scale: 'room', parent: 'room' }, lost: { label: 'a room', scale: 'room', parent: 'city' } },
  scenes: [{ id: 'u1', place: 'room' }, { id: 'u2', place: 'hall' }, { id: 'u3', place: 'room' }, { id: 'u4', place: 'lost' }, { id: 'u5', place: 'city' }],
};
const lot = { index: 7, place: 'dorm', floors: 3, rooms: [{ floor: 0, i0: 0, j0: 0, i1: 5, j1: 5 }, { floor: 1, i0: 0, j0: 0, i1: 1, j1: 1 }, { floor: 1, i0: 2, j0: 0, i1: 2, j1: 1 }, { floor: 1, i0: 0, j0: 2, i1: 5, j1: 5, kind: 'hall' }] };
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
