export class AudioPlayer {
  readonly element = new Audio();
  private objectUrl: string | undefined;

  constructor() {
    this.element.preservesPitch = true;
    this.element.preload = 'auto';
  }

  /** Rejects when the browser cannot decode the file. */
  load(file: File): Promise<void> {
    this.pause();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
    }
    this.objectUrl = URL.createObjectURL(file);

    return new Promise((resolve, reject) => {
      const done = (error?: Error): void => {
        this.element.removeEventListener('loadedmetadata', onLoaded);
        this.element.removeEventListener('error', onError);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onLoaded = (): void => done();
      const onError = (): void => done(new Error('This browser cannot play that audio file.'));
      this.element.addEventListener('loadedmetadata', onLoaded);
      this.element.addEventListener('error', onError);
      this.element.src = this.objectUrl!;
    });
  }

  get loaded(): boolean {
    return this.objectUrl !== undefined && Number.isFinite(this.element.duration);
  }

  get playing(): boolean {
    return !this.element.paused && !this.element.ended;
  }

  get currentMs(): number {
    return this.element.currentTime * 1000;
  }

  get durationMs(): number {
    return Number.isFinite(this.element.duration) ? this.element.duration * 1000 : 0;
  }

  seekMs(ms: number): void {
    const max = this.durationMs || ms;
    this.element.currentTime = Math.min(Math.max(ms, 0), max) / 1000;
  }

  setRate(rate: number): void {
    this.element.playbackRate = rate;
  }

  async play(): Promise<void> {
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  async toggle(): Promise<void> {
    if (this.playing) {
      this.pause();
    } else {
      await this.play();
    }
  }
}
