import PQueue from 'p-queue';

// A separate queue for filesystem operations to avoid disk I/O contention.
const fsQueue = new PQueue({ concurrency: 1 });

export default fsQueue;
