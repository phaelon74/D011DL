import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 1 }); // Concurrency set to 1 to download one model at a time

export default queue;
