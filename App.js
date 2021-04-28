import React, {useState} from 'react';
import * as Permissions from 'expo-permissions';
import {View, SafeAreaView, Button, StyleSheet} from 'react-native';
import {RTCPeerConnection, mediaDevices} from 'react-native-webrtc';
import {Base64, rpc, uuidv4} from './utilities'

export default function App() {
  const [cachedStream, setCachedStream] = useState();
  const [cachedLocalPeerConnection, setCachedLocalPeerConnection] = useState();
  const [localTrack, setLocalTrack] = useState();
  const [uid] = useState(uuidv4())
  const [isMuted, setIsMuted] = useState(false);
  const [microphonePermission, askMicrophonePermission] = Permissions.usePermissions(Permissions.AUDIO_RECORDING, { ask: true });

  const ICE_POLICY = 'relay';

  const room = 'test';
  const name = 'native';
  const username = `${uid}:${Base64.encode(name)}`;

  const encodedRoom = encodeURIComponent(room);
  const encodedUsername = encodeURIComponent(username);

  console.log('uid', uid)
  console.log('username', username)
  console.log('encodedRoom', encodedRoom)
  console.log('encodedUsername', encodedUsername)
  console.log('localTrack', localTrack)

  if (!microphonePermission) {
    console.log(microphonePermission)
    askMicrophonePermission()
  }

  async function getRtcPeerConfiguration () {
    const res = await rpc('turn', [encodedUsername]);
    console.log(res)

    const configuration = {
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      sdpSemantics: 'unified-plan'
    };

    if (ICE_POLICY === 'relay' && res.data && res.data.length > 0) {
      configuration.iceServers = res.data;
      configuration.iceTransportPolicy = 'relay';
    } else {
      configuration.iceServers = [];
      configuration.iceTransportPolicy = 'all';
    }

    console.log('CONFIGURATION', configuration)

    return configuration;
  }

  async function setupRtcPeerConnection () {
    const localPeerConnection = new RTCPeerConnection(await getRtcPeerConfiguration());
    // localPeerConnection.onicecandidate = onIceCandidate
    // localPeerConnection.ontrack = onTrack // ontrack event listener is not supported by react-native-webrtc
    const stream = await setupStream(localPeerConnection)
    await connect(localPeerConnection)
    return { localPeerConnection, stream }
  }

  async function setupStream (localPeerConnection) {
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    // AddTrack not supported yet, so have to use old school addStream instead
    // newStream.getTracks().forEach(track => localPC.addTrack(track, newStream));
    localPeerConnection.addStream(stream);
    return stream;
  }

  const toggleMute = () => {
    cachedStream.getAudioTracks().forEach(track => {
      console.log(track.enabled ? 'muting' : 'unmuting', ' local track', track);
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    });
  };

  const startCall = async () => {
    try {
      const {localPeerConnection, stream} = await setupRtcPeerConnection()
      console.log(localPeerConnection)
      console.log(stream)
      setCachedStream(stream);
      setCachedLocalPeerConnection(localPeerConnection);
      console.log('STARTED CALL')
    } catch (err) {
      console.log(err)
    }
  };

  const endCall = () => {
    if (cachedLocalPeerConnection) {
      cachedLocalPeerConnection.removeStream(cachedStream);
      cachedLocalPeerConnection.close();
    }
    setCachedStream();
    setCachedLocalPeerConnection();
    console.log('ENDED CALL')
  };

  async function connect(localPeerConnection) {
    const offer = await localPeerConnection.createOffer();
    console.log('OFFER', offer)
    await localPeerConnection.setLocalDescription(offer);
    publish(localPeerConnection)
  }

  async function subscribe(localPeerConnection, localTrack) {
    console.log('subscribing...')
    const response = await rpc('subscribe', [encodedRoom, encodedUsername, localTrack]);
    if (response.error && typeof response.error === 'string' && response.error.indexOf(encodedUsername + ' not found in')) {
      localPeerConnection.close();
      await start();
      return;
    }
    if (response.data) {
      var jsep = JSON.parse(response.data.jsep);
      if (jsep.type == 'offer') {
        await localPeerConnection.setRemoteDescription(jsep);
        var sdp = await localPeerConnection.createAnswer();
        await localPeerConnection.setLocalDescription(sdp);
        await rpc('answer', [encodedRoom, encodedUsername, localTrack, JSON.stringify(sdp)]);
      }
    }
    setTimeout(function () {
      if (cachedLocalPeerConnection) {
        subscribe(cachedLocalPeerConnection, localTrack);
      }
    }, 3000);
  }

  async function publish (localPeerConnection) {
    const res = await rpc('publish', [encodedRoom, encodedUsername, JSON.stringify(localPeerConnection.localDescription)]);
    if (res.data) {
      const jsep = JSON.parse(res.data.jsep);
      if (jsep.type == 'answer') {
        await localPeerConnection.setRemoteDescription(jsep);
        const localTrack = res.data.track;
        setLocalTrack(localTrack);
        console.log('LOCAL TRACK', res.data.track)
        localPeerConnection.onicecandidate = ({candidate}) => onIceCandidate(candidate, localTrack)
        subscribe(localPeerConnection, localTrack);
      }
    }
  }

  function onIceCandidate (candidate, localTrack) {
    rpc('trickle', [encodedRoom, encodedUsername, localTrack, JSON.stringify(candidate)]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {cachedStream && (
        <View style={styles.toggleButtons}>
          <Button title={`${isMuted ? 'Unmute' : 'Mute'} stream`} onPress={toggleMute} />
        </View>
      )}
      <Button title="Join" onPress={startCall} />
      <Button title="Leave" onPress={endCall} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#313131',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '100%',
  },
  text: {
    fontSize: 30,
  },
  rtcview: {
    justifyContent: 'center',
    alignItems: 'center',
    height: '40%',
    width: '80%',
    backgroundColor: 'black',
  },
  rtc: {
    width: '80%',
    height: '100%',
  },
  toggleButtons: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
});