/**
 * System tools: get_current_time, get_user_profile
 */

import http from 'node:http';
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { textResult } from './tool-utils';

export function createGetCurrentTime(): AgentTool {
  return {
    name: 'get_current_time',
    description: 'Get the current date and time in ISO format.',
    label: 'Get Current Time',
    parameters: Type.Object({}),
    execute: async () => {
      return textResult(new Date().toISOString());
    },
  };
}

export function createGetUserProfile(ctx: ToolContext): AgentTool {
  return {
    name: 'get_user_profile',
    description: "Get the user's profile information from memory context files.",
    label: 'Get User Profile',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const profile = await new Promise<string>((resolve, reject) => {
          const req = http.get(
            `http://127.0.0.1:${ctx.backendPort}/memory/context-files/profile`,
            (res) => {
              if (res.statusCode !== 200) {
                resolve('No user profile set.');
                res.resume();
                return;
              }
              let data = '';
              res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
              });
              res.on('end', () => {
                try {
                  const parsed = JSON.parse(data);
                  resolve(parsed.content || 'No user profile set.');
                } catch {
                  resolve('No user profile set.');
                }
              });
            },
          );
          req.on('error', () => resolve('No user profile set.'));
          req.setTimeout(5000, () => {
            req.destroy();
            resolve('No user profile set.');
          });
        });
        return textResult(profile);
      } catch {
        return textResult('No user profile set.');
      }
    },
  };
}
