import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../src/hooks/useWebSocket.js';

const state = () => ({
  captions: [],
  interim: null,
  presence: [],
  flags: {},
  requests: {},
  studentAlerts: [],
  session: null,
  teacherVideo: { active: false, speaker: null, frame: null },
  teacherAudioActive: false,
  teacherAudioOwned: false,
  teacherAudioError: null,
  audioListening: false,
  audioListeners: [],
  studentVideos: {}
});

test('student captions create one dismissible alert while teacher captions do not', () => {
  const caption = { id: 12, source: 'sign', speaker: 'Student One', text: 'I need help' };
  const withAlert = reducer(state(), { type: 'caption', caption });
  assert.deepEqual(withAlert.studentAlerts, [{
    id: 'caption-12',
    kind: 'caption',
    speaker: 'Student One',
    source: 'sign',
    text: 'I need help'
  }]);

  assert.equal(reducer(withAlert, { type: 'caption', caption }), withAlert);
  const withTeacherCaption = reducer(withAlert, {
    type: 'caption',
    caption: { id: 13, source: 'speech', speaker: 'Teacher', text: 'Let us continue' }
  });
  assert.equal(withTeacherCaption.studentAlerts.length, 1);
  assert.equal(reducer(withTeacherCaption, { type: 'dismiss_student_alert', id: 'caption-12' }).studentAlerts.length, 0);
});

test('student requests update totals and create dismissible alerts', () => {
  const withRequest = reducer(state(), {
    type: 'request',
    counts: { repeat: 1 },
    alert: { id: 'request-1', kind: 'request', speaker: 'Student One', request: 'repeat' }
  });
  assert.deepEqual(withRequest.requests, { repeat: 1 });
  assert.deepEqual(withRequest.studentAlerts, [{
    id: 'request-1',
    kind: 'request',
    speaker: 'Student One',
    request: 'repeat'
  }]);
  assert.equal(reducer(withRequest, { type: 'clear_student_alerts' }).studentAlerts.length, 0);
});

test('audio state tracks teacher ownership and student listening opt-in', () => {
  const active = reducer(state(), { type: 'teacher_audio_state', active: true, owned: true });
  assert.equal(active.teacherAudioActive, true);
  assert.equal(active.teacherAudioOwned, true);

  const listening = reducer(active, { type: 'audio_listen_state', active: true, teacherAudioActive: true });
  assert.equal(listening.audioListening, true);
  assert.equal(listening.teacherAudioActive, true);
  assert.equal(reducer(listening, { type: 'teacher_audio_state', active: true, owned: false, error: 'busy' }).teacherAudioError, 'busy');
  assert.equal(reducer(listening, { type: 'clear_teacher_audio_error' }).teacherAudioError, null);
});
