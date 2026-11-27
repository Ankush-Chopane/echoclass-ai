import { useCallback, useEffect, useRef, useState } from 'react';

const EMPTY_ICE_SERVERS = [];

function mediaError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'Microphone permission was blocked. Allow microphone access in your browser settings.';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
    return 'No microphone was found on this device.';
  }
  if (error?.name === 'NotReadableError') {
    return 'The microphone is already in use by another application.';
  }
  return `Could not start live audio (${error?.name || 'error'}).`;
}

function connectionError(iceServers) {
  const hasTurnRelay = iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => typeof url === 'string' && /^turns?:/i.test(url));
  });
  return hasTurnRelay
    ? 'Live audio could not connect through the TURN relay. Check the relay settings or try again.'
    : 'This network blocks direct live audio. A TURN relay must be configured by the school for cross-network listening.';
}

export function useClassAudio({
  isTeacher,
  connected,
  ended,
  sendRaw,
  clearTeacherAudioError,
  subscribeAudioSignals,
  teacherAudioActive,
  teacherAudioOwned,
  teacherAudioError,
  audioListening,
  audioListeners,
  iceServers = EMPTY_ICE_SERVERS
}) {
  const [teacherStatus, setTeacherStatus] = useState('off');
  const [studentError, setStudentError] = useState('');
  const [teacherError, setTeacherError] = useState('');
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const audioRef = useRef(null);
  const localStream = useRef(null);
  const peers = useRef(new Map());
  const pendingCandidates = useRef(new Map());
  const startGeneration = useRef(0);
  const handleSignalRef = useRef(null);
  const confirmationTimer = useRef(null);

  const clearRemoteAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    setPlaybackBlocked(false);
  }, []);

  const closePeer = useCallback((userId) => {
    const peer = peers.current.get(userId);
    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
      peers.current.delete(userId);
    }
    pendingCandidates.current.delete(userId);
    if (!isTeacher) clearRemoteAudio();
  }, [clearRemoteAudio, isTeacher]);

  const closeAllPeers = useCallback(() => {
    for (const peer of peers.current.values()) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    peers.current.clear();
    pendingCandidates.current.clear();
    if (!isTeacher) clearRemoteAudio();
  }, [clearRemoteAudio, isTeacher]);

  const sendSignal = useCallback((userId, signal) => {
    sendRaw({ type: 'audio_signal', toUserId: userId, signal });
  }, [sendRaw]);

  const makePeer = useCallback((userId) => {
    const existing = peers.current.get(userId);
    if (existing) return existing;

    const peer = new RTCPeerConnection({ iceServers });
    peers.current.set(userId, peer);
    peer.onicecandidate = (event) => {
      if (event.candidate) sendSignal(userId, { type: 'candidate', candidate: event.candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') {
        const message = connectionError(iceServers);
        if (isTeacher) setTeacherError(message);
        else setStudentError(message);
      }
    };

    if (isTeacher) {
      for (const track of localStream.current?.getAudioTracks() || []) peer.addTrack(track, localStream.current);
    } else {
      peer.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        const audio = audioRef.current;
        if (!audio) return;
        audio.srcObject = stream;
        audio.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
      };
    }
    return peer;
  }, [iceServers, isTeacher, sendSignal]);

  const addPendingCandidates = useCallback(async (userId, peer) => {
    const candidates = pendingCandidates.current.get(userId) || [];
    pendingCandidates.current.delete(userId);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  }, []);

  const handleSignal = useCallback(async (message) => {
    if (!connected || ended || !Number.isSafeInteger(message.fromUserId)) return;
    const { fromUserId, signal } = message;
    try {
      if (isTeacher) {
        if (!teacherAudioOwned || !localStream.current) return;
        const peer = peers.current.get(fromUserId);
        if (!peer) return;
        if (signal.type === 'answer') {
          await peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          await addPendingCandidates(fromUserId, peer);
        } else if (signal.type === 'candidate') {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
          else pendingCandidates.current.set(fromUserId, [...(pendingCandidates.current.get(fromUserId) || []), signal.candidate]);
        }
        return;
      }

      if (!audioListening || !teacherAudioActive) return;
      if (signal.type === 'offer') {
        if (peers.current.has(fromUserId)) closePeer(fromUserId);
        const peer = makePeer(fromUserId);
        await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        await addPendingCandidates(fromUserId, peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal(fromUserId, { type: 'answer', sdp: peer.localDescription.sdp });
      } else if (signal.type === 'candidate') {
        const peer = peers.current.get(fromUserId);
        if (peer?.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else pendingCandidates.current.set(fromUserId, [...(pendingCandidates.current.get(fromUserId) || []), signal.candidate]);
      }
    } catch (error) {
      const messageText = `Live audio setup failed (${error?.name || 'connection error'}).`;
      if (isTeacher) setTeacherError(messageText);
      else setStudentError(messageText);
      closePeer(fromUserId);
    }
  }, [addPendingCandidates, audioListening, closePeer, connected, ended, isTeacher, makePeer, sendSignal, teacherAudioActive, teacherAudioOwned]);

  handleSignalRef.current = handleSignal;
  useEffect(() => subscribeAudioSignals((message) => handleSignalRef.current?.(message)), [subscribeAudioSignals]);

  const startTeacherAudio = useCallback(async () => {
    if (!connected || ended) {
      setTeacherError('Reconnect to the classroom before enabling live audio.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setTeacherStatus('error');
      setTeacherError('Live audio requires a modern browser on HTTPS (or localhost).');
      return;
    }

    const generation = ++startGeneration.current;
    clearTeacherAudioError();
    setTeacherError('');
    setTeacherStatus('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false
      });
      if (generation !== startGeneration.current || !connected || ended) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const tracks = stream.getAudioTracks();
      if (!tracks.length) throw new Error('No audio track was created.');
      tracks.forEach((track) => { track.contentHint = 'speech'; });
      localStream.current = stream;
      tracks[0].addEventListener('ended', () => {
        if (localStream.current === stream) {
          clearTimeout(confirmationTimer.current);
          confirmationTimer.current = null;
          localStream.current = null;
          sendRaw({ type: 'teacher_audio_state', active: false });
          closeAllPeers();
          setTeacherStatus('error');
          setTeacherError('The microphone stopped. Check the device and enable live audio again.');
        }
      });
      if (!sendRaw({ type: 'teacher_audio_state', active: true })) throw new Error('The classroom connection was lost.');
      confirmationTimer.current = setTimeout(() => {
        confirmationTimer.current = null;
        if (localStream.current !== stream) return;
        localStream.current.getTracks().forEach((track) => track.stop());
        localStream.current = null;
        closeAllPeers();
        setTeacherStatus('error');
        setTeacherError('The classroom did not confirm live audio. Reconnect and try again.');
      }, 8000);
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (localStream.current === stream) localStream.current = null;
      if (generation !== startGeneration.current) return;
      setTeacherStatus('error');
      setTeacherError(error?.name && error.name !== 'Error' ? mediaError(error) : `Live audio could not start: ${error.message}`);
    }
  }, [clearTeacherAudioError, closeAllPeers, connected, ended, sendRaw]);

  const stopTeacherAudio = useCallback(() => {
    startGeneration.current += 1;
    clearTimeout(confirmationTimer.current);
    confirmationTimer.current = null;
    if (isTeacher) sendRaw({ type: 'teacher_audio_state', active: false });
    else if (audioListening) sendRaw({ type: 'audio_listen', active: false });
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    closeAllPeers();
    setTeacherStatus('off');
    setTeacherError('');
  }, [audioListening, closeAllPeers, isTeacher, sendRaw]);

  const listen = useCallback((active) => {
    if (isTeacher) return;
    if (active && (!connected || ended || !teacherAudioActive)) {
      setStudentError('Live audio is not currently available.');
      return;
    }
    if (active && typeof RTCPeerConnection === 'undefined') {
      setStudentError('Live audio is not supported by this browser.');
      return;
    }
    if (!sendRaw({ type: 'audio_listen', active })) {
      setStudentError('Reconnect to the classroom before changing your listening setting.');
      return;
    }
    setStudentError('');
    if (!active) closeAllPeers();
  }, [closeAllPeers, connected, ended, isTeacher, sendRaw, teacherAudioActive]);

  const playbackStarted = useCallback(() => setPlaybackBlocked(false), []);

  useEffect(() => {
    if (isTeacher && teacherAudioActive && teacherAudioOwned && localStream.current) {
      clearTimeout(confirmationTimer.current);
      confirmationTimer.current = null;
      setTeacherStatus('on');
      setTeacherError('');
    } else if (isTeacher && teacherAudioError && teacherStatus === 'starting') {
      clearTimeout(confirmationTimer.current);
      confirmationTimer.current = null;
      localStream.current?.getTracks().forEach((track) => track.stop());
      localStream.current = null;
      closeAllPeers();
      setTeacherStatus('error');
      setTeacherError(teacherAudioError === 'busy'
        ? 'Another teacher device is already sharing live audio.'
        : 'Live audio could not be enabled.');
    } else if (isTeacher && teacherStatus === 'on' && (!teacherAudioActive || !teacherAudioOwned)) {
      localStream.current?.getTracks().forEach((track) => track.stop());
      localStream.current = null;
      closeAllPeers();
      setTeacherStatus('off');
    }
  }, [closeAllPeers, isTeacher, teacherAudioActive, teacherAudioError, teacherAudioOwned, teacherStatus]);

  useEffect(() => {
    if (!isTeacher && (!audioListening || !teacherAudioActive)) closeAllPeers();
  }, [audioListening, closeAllPeers, isTeacher, teacherAudioActive]);

  useEffect(() => {
    if (!connected || ended) {
      closeAllPeers();
      if (isTeacher && (localStream.current || teacherStatus === 'starting')) {
        startGeneration.current += 1;
        clearTimeout(confirmationTimer.current);
        confirmationTimer.current = null;
        localStream.current?.getTracks().forEach((track) => track.stop());
        localStream.current = null;
        setTeacherStatus('off');
      }
    }
  }, [closeAllPeers, connected, ended, isTeacher, teacherStatus]);

  const listenerIds = (audioListeners || []).map((listener) => listener.userId);
  useEffect(() => {
    if (!isTeacher || !connected || ended || !teacherAudioActive || !teacherAudioOwned || !localStream.current) {
      if (isTeacher && (!teacherAudioActive || !teacherAudioOwned || ended)) closeAllPeers();
      return;
    }

    const wanted = new Set(listenerIds);
    for (const userId of wanted) {
      if (peers.current.has(userId)) continue;
      const peer = makePeer(userId);
      (async () => {
        try {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          sendSignal(userId, { type: 'offer', sdp: peer.localDescription.sdp });
        } catch (error) {
          if (peers.current.get(userId) === peer) closePeer(userId);
          setTeacherError(`Could not connect to a student for live audio (${error?.name || 'error'}).`);
        }
      })();
    }
    for (const userId of peers.current.keys()) {
      if (!wanted.has(userId)) closePeer(userId);
    }
  }, [closePeer, connected, ended, isTeacher, listenerIds.join(','), makePeer, sendSignal, teacherAudioActive, teacherAudioOwned]);

  useEffect(() => () => {
    startGeneration.current += 1;
    clearTimeout(confirmationTimer.current);
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    for (const peer of peers.current.values()) peer.close();
    peers.current.clear();
    pendingCandidates.current.clear();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
  }, []);

  return {
    audioRef,
    teacherStatus,
    teacherError,
    studentError,
    playbackBlocked,
    startTeacherAudio,
    stopTeacherAudio,
    listen,
    playbackStarted,
    teacherListeningCount: audioListeners?.length || 0
  };
}
