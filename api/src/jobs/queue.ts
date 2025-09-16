import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 1 }); // Concurrency set to 1 to process one job at a time (download)

export default queue;
