'use strict';

const hl7 = require('../../src/services/hl7/codec');

describe('HL7 codec', () => {
  it('escapes and unescapes HL7 delimiters safely', () => {
    const raw = 'A|B^C~D&E\\F\rG\nH';
    const escaped = hl7.escapeValue(raw);

    expect(escaped).toBe('A\\F\\B\\S\\C\\R\\D\\T\\E\\E\\F\\X0D\\G\\X0A\\H');
    expect(hl7.unescapeValue(escaped)).toBe(raw);
  });

  it('escapes on Node 14, which has no String.prototype.replaceAll (production runtime)', () => {
    const { replaceAll } = String.prototype;
    delete String.prototype.replaceAll;
    try {
      expect(hl7.escapeValue('A|B^C~D&E\\F')).toBe('A\\F\\B\\S\\C\\R\\D\\T\\E\\E\\F');
    } finally {
      String.prototype.replaceAll = replaceAll;
    }
  });

  it('builds segments from structured fields without leaking delimiters', () => {
    const segment = hl7.buildSegment('PID', [
      '1',
      null,
      'PAT-001',
      null,
      ['Doe|Pipe', 'Jane^Caret'],
      null,
      '19860101',
      'F',
    ]);

    expect(segment).toBe('PID|1||PAT-001||Doe\\F\\Pipe^Jane\\S\\Caret||19860101|F');
  });

  it('builds and parses an ORM O01 message', () => {
    const message = hl7.ormO01({
      sendingApp: 'GATEWAY',
      sendingFacility: 'HIS',
      receivingApp: 'RIS',
      receivingFacility: 'RAD',
      messageControlId: 'MSG-1',
      orderControl: 'NW',
      patient: {
        id: 'P-1',
        name: 'Rao',
        sex: 'M',
        birthDate: '19900101',
      },
      order: {
        orderId: 'ORD-1',
        placerOrderNumber: 'ORD-1',
        fillerOrderNumber: 'CENTER-1',
        testId: 'XR-CHEST',
        testName: 'X-Ray Chest',
        priority: 'STAT',
        modality: 'CR',
      },
    });

    expect(message).toContain('MSH|^~\\&|GATEWAY|HIS|RIS|RAD|');
    expect(message).toContain('|ORM^O01|MSG-1|P|2.3');
    expect(message).toContain('\rPID|||P-1||Rao||19900101|M');
    expect(message).toContain('\rORC|NW|ORD-1');
    expect(message).toContain('\rOBR||ORD-1|CENTER-1|XR-CHEST^X-Ray Chest|STAT');

    const parsed = hl7.parseMessage(message);
    expect(parsed.messageType).toEqual({ code: 'ORM', trigger: 'O01' });
    expect(parsed.messageControlId).toBe('MSG-1');
    expect(parsed.getFirst('PID').fields[2].value).toBe('P-1');
  });

  it('parses ACK messages and exposes accept/error semantics', () => {
    const accepted = hl7.parseAck('MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-1|P|2.3\rMSA|AA|MSG-1|OK\r');
    expect(accepted.accepted).toBe(true);
    expect(accepted.code).toBe('AA');
    expect(accepted.messageControlId).toBe('MSG-1');

    const rejected = hl7.parseAck('MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-2|P|2.3\rMSA|AE|MSG-2|Missing PID\r');
    expect(rejected.accepted).toBe(false);
    expect(rejected.errorMessage).toBe('Missing PID');
  });

  it('detects custom HL7 delimiters from MSH', () => {
    const parsed = hl7.parseMessage('MSH*%?$#*RIS*RAD*GW*HIS*20260101010101**ORM%O01*MSG-2*P*2.3\rPID***P-2**Doe%Jane\r');

    expect(parsed.separators).toEqual({
      field: '*',
      component: '%',
      repetition: '?',
      escape: '$',
      subcomponent: '#',
    });
    expect(parsed.messageType).toEqual({ code: 'ORM', trigger: 'O01' });
    expect(parsed.messageControlId).toBe('MSG-2');
    expect(parsed.getFirst('PID').fields[4].repetitions[0][0][0]).toBe('Doe');
    expect(parsed.getFirst('PID').fields[4].repetitions[0][1][0]).toBe('Jane');
  });

  it('builds ACK messages from the original inbound message', () => {
    const original = 'MSH|^~\\&|HIS|MAIN|GW|INT|20260101010101||ORM^O01|MSG-500|P|2.3\rPID|||P-500\r';
    const ackMessage = hl7.buildAck({
      originalMessage: original,
      code: 'AE',
      text: 'Validation failed',
      sendingApp: 'GW',
      sendingFacility: 'INT',
    });

    expect(ackMessage).toContain('MSH|^~\\&|GW|INT|HIS|MAIN|');
    expect(ackMessage).toContain('|ACK^O01|');
    expect(ackMessage).toContain('\rMSA|AE|MSG-500|Validation failed\r');
    expect(hl7.parseAck(ackMessage)).toEqual(
      expect.objectContaining({
        accepted: false,
        code: 'AE',
        messageControlId: 'MSG-500',
        errorMessage: 'Validation failed',
      })
    );
  });

  it('frames and extracts MLLP messages even when data arrives with extra bytes', () => {
    const message = 'MSH|^~\\&|A|B|C|D|20260101010101||ACK|1|P|2.3\rMSA|AA|1\r';
    const framed = hl7.frameMllp(message);
    const combined = Buffer.concat([Buffer.from('noise'), framed, Buffer.from('tail')]);

    expect(framed[0]).toBe(0x0b);
    expect(framed[framed.length - 2]).toBe(0x1c);
    expect(framed[framed.length - 1]).toBe(0x0d);
    expect(hl7.extractMllpFrames(combined)).toEqual([message]);
  });

  it('rejects obviously unsafe or malformed messages', () => {
    expect(() => hl7.parseMessage('PID|||P-1\r')).toThrow(/MSH/);
    expect(() => hl7.buildSegment('BAD|SEG', ['x'])).toThrow(/segment name/i);
    expect(() => hl7.frameMllp('')).toThrow(/message/i);
  });
});
