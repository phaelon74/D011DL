import PQueue from 'p-queue';

const uploadQueue = new PQueue({ concurrency: 1 }); // One upload at a time

export default uploadQueue;


