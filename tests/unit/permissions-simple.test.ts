import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPermissionInstructions } from '../../src/permissions';

describe('permissions - simple tests', () => {
  describe('getPermissionInstructions', () => {
    it('should return helpful permission instructions', () => {
      const instructions = getPermissionInstructions();
      
      expect(instructions).toContain('Screen Recording Permission');
      expect(instructions).toContain('Accessibility Permission');
      expect(instructions).toContain('System Preferences');
      expect(instructions).toContain('Security & Privacy');
      expect(instructions).toContain('Privacy');
      expect(instructions).not.toContain('undefined');
      expect(instructions.trim()).not.toBe('');
    });

    it('should include both permission types in instructions', () => {
      const instructions = getPermissionInstructions();
      
      expect(instructions).toMatch(/Screen Recording.*Accessibility/s);
    });

    it('should include restart instructions', () => {
      const instructions = getPermissionInstructions();
      
      expect(instructions).toContain('restart');
      expect(instructions).toContain('application');
    });

    it('should include unlock instruction', () => {
      const instructions = getPermissionInstructions();
      
      expect(instructions).toContain('unlock');
      expect(instructions).toContain('lock icon');
    });

    it('should be properly formatted', () => {
      const instructions = getPermissionInstructions();
      
      // Should start and end without extra whitespace
      expect(instructions).toBe(instructions.trim());
      
      // Should contain numbered steps
      expect(instructions).toMatch(/1\./);
      expect(instructions).toMatch(/2\./);
      
      // Should contain proper sections
      expect(instructions).toContain('macOS Simulator MCP');
    });
  });
});