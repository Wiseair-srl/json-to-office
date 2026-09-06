import { describe, expect, it } from 'vitest';
import { isPrivateServiceUrl, remoteExportNotice } from './serviceUrl';

describe('isPrivateServiceUrl', () => {
  it.each([
    'http://localhost:7801',
    'localhost:7801',
    'http://127.0.0.1:7801',
    'http://[::1]:7801',
    'http://10.0.0.5:7801',
    'http://172.20.1.9',
    'http://192.168.1.20:7801',
    'http://charts.internal',
    'https://render.corp.local',
    'http://charts.home.arpa.',
    'http://[fd12:3456::1]:7801',
  ])('treats %s as private', (url) => {
    expect(isPrivateServiceUrl(url)).toBe(true);
  });

  it.each([
    'https://export.highcharts.com',
    'https://charts.example.com',
    'http://charts',
    'http://charts.corp',
    'http://100.64.0.1',
    'http://172.32.0.1',
    'http://8.8.8.8:7801',
    '',
  ])('treats %s as remote', (url) => {
    expect(isPrivateServiceUrl(url)).toBe(false);
  });
});

describe('remoteExportNotice', () => {
  it('says nothing for a private server, refuses a public one, announces an allowed one', () => {
    expect(
      remoteExportNotice('http://localhost:7801', undefined)
    ).toBeUndefined();
    expect(() =>
      remoteExportNotice('https://charts.example.com', false)
    ).toThrow(/charts\.example\.com.*allowRemote.*HIGHCHARTS_ALLOW_REMOTE/s);
    expect(remoteExportNotice('https://charts.example.com', true)).toContain(
      'https://charts.example.com'
    );
  });
});
