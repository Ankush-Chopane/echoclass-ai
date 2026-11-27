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
  notifications: [],
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
  const startedAt = Date.now();
  const caption = { id: 12, source: 'sign', speaker: 'Student One', text: 'I need help' };
  const withAlert = reducer(state(), { type: 'caption', caption });
  const [alert] = withAlert.studentAlerts;
  assert.equal(alert.id, 'caption-12');
  assert.equal(alert.text, 'I need help');
  assert.ok(alert.expiresAt >= startedAt + 29_000);
  assert.equal(withAlert.notifications[0].read, false);
  assert.equal(withAlert.notifications[0].text, alert.text);

  assert.equal(reducer(withAlert, { type: 'caption', caption }), withAlert);
  const withTeacherCaption = reducer(withAlert, {
    type: 'caption',
    caption: { id: 13, source: 'speech', speaker: 'Teacher', text: 'Let us continue' }
  });
  assert.equal(withTeacherCaption.studentAlerts.length, 1);
  const dismissed = reducer(withTeacherCaption, { type: 'dismiss_student_alert', id: 'caption-12' });
  assert.equal(dismissed.studentAlerts.length, 0);
  assert.equal(dismissed.notifications.length, 1);
});

test('student requests update totals and create dismissible alerts', () => {
  const startedAt = Date.now();
  const withRequest = reducer(state(), {
    type: 'request',
    counts: { repeat: 1 },
    alert: { id: 'request-1', kind: 'request', speaker: 'Student One', request: 'repeat' }
  });
  assert.deepEqual(withRequest.requests, { repeat: 1 });
  assert.equal(withRequest.studentAlerts[0].id, 'request-1');
  assert.equal(withRequest.studentAlerts[0].request, 'repeat');
  assert.ok(withRequest.studentAlerts[0].expiresAt >= startedAt + 29_000);
  assert.equal(reducer(withRequest, { type: 'clear_student_alerts' }).studentAlerts.length, 0);
  assert.equal(withRequest.notifications.length, 1);
});

test('notification history can be read, cleared, and reset per class', () => {
  const withNotification = reducer(state(), {
    type: 'request',
    alert: { id: 'request-2', kind: 'request', speaker: 'Student Two', request: 'repeat' }
  });
  const read = reducer(withNotification, { type: 'mark_notifications_read' });
  assert.equal(read.notifications[0].read, true);
  assert.equal(reducer(read, { type: 'clear_notifications' }).notifications.length, 0);
  assert.equal(reducer(read, { type: 'reset' }).notifications.length, 0);
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

test('classroom initialization stores fresh ICE servers for WebRTC', () => {
  const iceServers = [{ urls: ['stun:stun.example.com:3478'] }];
  const connected = reducer(state(), { type: 'init', iceServers });
  assert.deepEqual(connected.iceServers, iceServers);
  assert.deepEqual(reducer(connected, { type: 'init' }).iceServers, []);
});
