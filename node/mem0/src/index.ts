#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  Tool,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryClient } from 'mem0ai';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const MEM0_API_KEY = process?.env?.MEM0_API_KEY || '';

// Initialize mem0ai client
const memoryClient = new MemoryClient({ apiKey: MEM0_API_KEY });

// Tool definitions
const ADD_MEMORY_TOOL: Tool = {
  name: 'add-memory',
  description:
    'Add a new memory. This method is called everytime the user informs anything about themselves, their preferences, or anything that has any relevent information whcih can be useful in the future conversation. This can also be called when the user asks you to remember something.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to store in memory',
      },
      userId: {
        type: 'string',
        description: "User ID for memory storage. If not provided explicitly, use a generic user ID like, 'mem0-mcp-user'",
      },
    },
    required: ['content', 'userId'],
  },
};

const SEARCH_MEMORIES_TOOL: Tool = {
  name: 'search-memories',
  description: 'Search through stored memories. This method is called ANYTIME the user asks anything.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: "The search query. This is the query that the user has asked for. Example: 'What did I tell you about the weather last week?' or 'What did I tell you about my friend John?'",
      },
      userId: {
        type: 'string',
        description: "User ID for memory storage. If not provided explicitly, use a generic user ID like, 'mem0-mcp-user'",
      },
    },
    required: ['query', 'userId'],
  },
};

const GET_PROCESS_TREE_TOOL: Tool = {
  name: 'get-process-tree',
  description:
    'Get the current process tree from the environment. This is similar to running `ps -eaf --forest` in a Linux environment.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

const EXECUTE_COMMAND_TOOL: Tool = {
  name: 'execute-command',
  description: 'Execute a shell command and return the output.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
    },
    required: ['command'],
  },
};

// Create server instance
const server = new Server(
  {
    name: 'mem0-mcp',
    version: '0.0.1',
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);

// Helper function to add memories
async function addMemory(content: string, userId: string) {
  try {
    const messages = [
      { role: 'user' as const, content } // Explicitly cast role to 'user'
    ];
    await memoryClient.add(messages, { user_id: userId });
    return true;
  } catch (error) {
    console.error('Error adding memory:', error);
    return false;
  }
}

// Helper function to search memories
async function searchMemories(query: string, userId: string) {
  try {
    const results = await memoryClient.search(query, { user_id: userId });
    return results;
  } catch (error) {
    console.error('Error searching memories:', error);
    return [];
  }
}

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [ADD_MEMORY_TOOL, SEARCH_MEMORIES_TOOL, GET_PROCESS_TREE_TOOL, EXECUTE_COMMAND_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error('No arguments provided');
    }

    switch (name) {
      case 'add-memory': {
        const { content, userId } = args as { content: string, userId: string };
        await addMemory(content, userId);
        return {
          content: [
            {
              type: 'text',
              text: 'Memory added successfully',
            },
          ],
          isError: false,
        };
      }

      case 'search-memories': {
        const { query, userId } = args as { query: string, userId: string };
        const results = await searchMemories(query, userId);
        const formattedResults = results.map((result: any) =>
          `Memory: ${result.memory}\nRelevance: ${result.score}\n---`
        ).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedResults || 'No memories found',
            },
          ],
          isError: false,
        };
      }

      case 'get-process-tree': {
        return new Promise((resolve) => {
          // Execute the ps command to get process information
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = path.dirname(__filename);
          const scriptPath = path.join(__dirname, 'ps-tree');
          exec(scriptPath, (error, stdout, stderr) => {
            if (error) {
              console.error(`Error executing ps command: ${error.message}`);
              resolve({
                content: [{ type: 'text', text: `Error executing ps command: ${error.message}` }],
                isError: true,
              });
              return;
            }
            if (stderr) {
              // stderr might contain warnings or informational messages, not always errors
              // For simplicity, we'll return it along with stdout if present
              // but mark as not an error unless stdout is empty.
              console.warn(`ps command stderr: ${stderr}`);
              resolve({
                content: [{ type: 'text', text: `Output:\n${stdout}\nStderr:\n${stderr}` }],
                isError: false,
              });
              return;
            }
            resolve({
              content: [{ type: 'text', text: stdout }],
              isError: false,
            });
          });
        });
      }

      case 'execute-command': {
        const { command } = args as { command: string };
        return new Promise((resolve) => {
          exec(`sh -c "${command}"`, (error, stdout, stderr) => {
            if (error) {
              console.error(`Error executing command: ${error.message}`);
              resolve({
                content: [{ type: 'text', text: `Error executing command: ${error.message}` }],
                isError: true,
              });
              return;
            }
            if (stderr) {
              console.warn(`Command stderr: ${stderr}`);
              resolve({
                content: [{ type: 'text', text: `Output:\n${stdout}\nStderr:\n${stderr}` }],
                isError: false, // Still resolve as not an error, but include stderr
              });
              return;
            }
            resolve({
              content: [{ type: 'text', text: stdout }],
              isError: false,
            });
          });
        });
      }

      default:
        return {
          content: [
            { type: 'text', text: `Unknown tool: ${name}` },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Function to log safely
function safeLog(
  level: 'error' | 'debug' | 'info' | 'notice' | 'warning' | 'critical' | 'alert' | 'emergency',
  data: any
): void {
  // For stdio transport, log to stderr to avoid protocol interference
  console.error(`[${level}] ${typeof data === 'object' ? JSON.stringify(data) : data}`);

  // Send to logging capability if available
  try {
    server.sendLoggingMessage({ level, data });
  } catch (error) {
    // Ignore errors when logging is not available
  }
}

// Server startup
async function main() {
  try {
    console.error('Initializing Mem0 Memory MCP Server...');

    const transport = new StdioServerTransport();
    await server.connect(transport);

    safeLog('info', 'Mem0 Memory MCP Server initialized successfully');
    console.error('Memory MCP Server running on stdio');
  } catch (error) {
    console.error('Fatal error running server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
