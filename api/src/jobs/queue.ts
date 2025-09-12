import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 3 }); // Concurrency from env later

export default queue;
