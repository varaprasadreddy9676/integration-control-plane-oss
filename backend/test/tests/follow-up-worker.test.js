'use strict';

const mockQueue = { claimDue: jest.fn() };
const mockService = { processFollowUp: jest.fn(async () => {}) };
const mockHeartbeat = {
  markWorkerRunError: jest.fn(),
  markWorkerRunStart: jest.fn(),
  markWorkerRunSuccess: jest.fn(),
  setWorkerState: jest.fn(),
  stopWorker: jest.fn(),
};
jest.mock('../../src/data/delivery-follow-ups', () => mockQueue);
jest.mock('../../src/services/delivery-follow-up', () => mockService);
jest.mock('../../src/worker-heartbeat', () => mockHeartbeat);
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const worker = require('../../src/processor/follow-up-worker');

const jobs = (n) => Array.from({ length: n }, (_, i) => ({ _id: `job-${i}`, logId: `log-${i}` }));
const queueOf = (list) => {
  const pending = [...list];
  mockQueue.claimDue.mockImplementation(async () => pending.shift() || null);
};

describe('follow-up worker', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => worker.stopFollowUpWorker());

  it('checks every due job and reports how many', async () => {
    queueOf(jobs(3));
    const processed = await worker.processDueFollowUps();
    expect(processed).toBe(3);
    expect(mockService.processFollowUp).toHaveBeenCalledTimes(3);
  });

  it('does nothing when no check is due', async () => {
    queueOf([]);
    expect(await worker.processDueFollowUps()).toBe(0);
    expect(mockService.processFollowUp).not.toHaveBeenCalled();
  });

  it('stops at the per-run cap so a backlog cannot flood the provider', async () => {
    queueOf(jobs(500));
    const processed = await worker.processDueFollowUps();
    expect(processed).toBeLessThanOrEqual(worker.MAX_PER_RUN + worker.CONCURRENCY);
    expect(processed).toBeGreaterThanOrEqual(worker.MAX_PER_RUN);
    expect(processed).toBeLessThan(500);
  });

  it('keeps going when one check fails', async () => {
    queueOf(jobs(3));
    mockService.processFollowUp.mockRejectedValueOnce(new Error('mongo blip'));
    const processed = await worker.processDueFollowUps();
    expect(processed).toBe(3);
    expect(mockService.processFollowUp).toHaveBeenCalledTimes(3);
  });

  it('never runs two passes at once', async () => {
    let release;
    mockQueue.claimDue.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    mockQueue.claimDue.mockResolvedValue(null);
    const first = worker.runOnce();
    const second = await worker.runOnce();
    expect(second).toBeNull();
    release(null);
    await first;
  });

  it('reports its state to the heartbeat and stops cleanly', async () => {
    queueOf([]);
    worker.startFollowUpWorker();
    expect(mockHeartbeat.setWorkerState).toHaveBeenCalledWith('followUpWorker', expect.objectContaining({ running: true }));
    await worker.runOnce();
    expect(mockHeartbeat.markWorkerRunSuccess).toHaveBeenCalledWith('followUpWorker', expect.anything());
    worker.stopFollowUpWorker();
    expect(mockHeartbeat.stopWorker).toHaveBeenCalledWith('followUpWorker');
  });

  it('reports a failed pass without crashing', async () => {
    mockQueue.claimDue.mockRejectedValue(new Error('db down'));
    await expect(worker.runOnce()).resolves.toBeNull();
    expect(mockHeartbeat.markWorkerRunError).toHaveBeenCalled();
  });
});
