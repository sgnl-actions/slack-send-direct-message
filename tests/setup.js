// Jest setup file
import { jest } from '@jest/globals';

// Mock fetch globally for all tests
global.fetch = jest.fn();