export default class Microphone {
  mediaRecorder: any = null;
  dataRequester: any = null;
  onUpdate: any = null;
  client: any = null;

  constructor(onUpdate: any, client: any) {
    this.onUpdate = onUpdate;
    this.client = client;
  }

  startRecording = () => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (!MediaRecorder.isTypeSupported('audio/webm'))
        return alert('Browser not supported');

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });
      this.mediaRecorder.addEventListener('dataavailable', (event: any) => {
        const data = event.data;
        if (data.size > 0) {
          this.client
            .extractVoiceData(data)
            .then((res: any) => this.onUpdate(res));
        }
      });
      this.mediaRecorder.start();
      this.dataRequester = setInterval(() => {
        this.mediaRecorder.stop();
        this.mediaRecorder.start();
      }, 1000);
    });
  };

  stopRecording = () => {
    clearInterval(this.dataRequester);

    if (this.mediaRecorder) {
      this.mediaRecorder.stop();

      // Stop the MediaStream tracks
      const stream = this.mediaRecorder.stream;
      if (stream) {
        const tracks = stream.getTracks();
        tracks.forEach((track: any) => track.stop());
      }
    }
  };
}
