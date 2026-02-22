import OpenAI from 'openai';
import { config } from '../utils/config-loader';
import { activityLogger, logger } from '../utils/logger';
import type { BotManager } from '../core/bot-manager';

const BOT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'move_to',
      description: 'Move the bot to specific X Y Z coordinates in the Minecraft world.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
          z: { type: 'number', description: 'Z coordinate' },
        },
        required: ['x', 'y', 'z'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'follow_player',
      description: 'Follow a specific player continuously at a given distance.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'The Minecraft username of the player to follow' },
          distance: {
            type: 'number',
            description: 'Distance to maintain from the player (1-16 blocks, default 3)',
          },
        },
        required: ['username'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mine_area',
      description:
        'Mine all diggable blocks within a rectangular 3D area defined by two corner coordinates.',
      parameters: {
        type: 'object',
        properties: {
          x1: { type: 'number', description: 'X coordinate of first corner' },
          y1: { type: 'number', description: 'Y coordinate of first corner' },
          z1: { type: 'number', description: 'Z coordinate of first corner' },
          x2: { type: 'number', description: 'X coordinate of opposite corner' },
          y2: { type: 'number', description: 'Y coordinate of opposite corner' },
          z2: { type: 'number', description: 'Z coordinate of opposite corner' },
        },
        required: ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_movement',
      description: 'Stop all current movement and mining operations immediately.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_chat',
      description: 'Send a public message in the Minecraft chat.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to send in chat' },
        },
        required: ['message'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: "Get the bot's current position, health, food, and dimension.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
];

export class LLMAgent {
  private readonly client: OpenAI;
  private readonly botManager: BotManager;

  constructor(botManager: BotManager) {
    this.client = new OpenAI({ apiKey: config.ai.apiKey });
    this.botManager = botManager;
  }

  async processMessage(playerMessage: string, sender: string): Promise<string> {
    const state = this.botManager.getState();
    const botName = config.minecraft.username;
    const personality = config.personality.type;
    const gender = config.personality.gender;

    const stateDescription = state
      ? `Position: (${Math.floor(state.position.x)}, ${Math.floor(state.position.y)}, ${Math.floor(state.position.z)}), health: ${state.health}/20, food: ${state.food}/20, dimension: ${state.dimension}.`
      : 'Not fully spawned yet.';

    const systemPrompt = [
      `You are a Minecraft bot named ${botName}.`,
      `Personality: ${personality} (${gender}).`,
      `Current state: ${stateDescription}`,
      `Player "${sender}" is talking to you.`,
      'Reply in the SAME language the player uses. Keep all messages concise (under 230 characters).',
      'When you are about to execute an action, use send_chat FIRST to briefly announce what you are going to do (e.g. "On my way!" or "Starting to mine that area.").',
      'After completing a task, send only a short confirmation (e.g. "Done!" or "Arrived!"). Never add filler phrases like "What else can I do?", "Anything else?", "Is there something else you need?", or similar.',
      'The bot automatically eats when hungry, defends against hostile mobs, and looks at nearby players when idle. You do not need to handle these.',
      'When mining or doing tasks, the bot automatically selects the best tool from its inventory unless the player specifies a particular tool to use.',
      'If the request is unclear or you cannot help, explain briefly without using tools.',
    ].join('\n');

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: playerMessage },
    ];

    activityLogger.info(`LLM request from ${sender}: ${playerMessage}`);

    const stopSignalAtStart = this.botManager.getStopSignal();

    // Agentic loop: keep calling OpenAI until we get a final text response (no tool calls)
    for (let round = 0; round < 10; round++) {
      const response = await this.client.chat.completions.create({
        model: config.ai.model,
        messages,
        tools: BOT_TOOLS,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      if (!choice) {
        return 'Something went wrong, I got no response.';
      }

      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      // If no tool calls, this is the final conversational reply
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const text = assistantMessage.content ?? '';
        activityLogger.info(`LLM response to ${sender}: ${text}`);
        return text.slice(0, 230);
      }

      // Execute each tool call and collect results
      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type !== 'function') {
          continue;
        }

        const toolName = toolCall.function.name;
        let args: Record<string, unknown> = {};

        try {
          args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          logger.warn(`LLM returned malformed tool arguments for ${toolName}`);
        }

        activityLogger.info(`LLM tool call: ${toolName}(${JSON.stringify(args)})`);

        let result: string;
        try {
          result = await this.executeTool(toolName, args);
        } catch (error) {
          result = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }

        activityLogger.info(`LLM tool result [${toolName}]: ${result}`);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      // If a stop was issued while tools were running, don't continue the loop —
      // a separate LLM request is already handling the stop command.
      if (this.botManager.wasStoppedAfter(stopSignalAtStart)) {
        activityLogger.info('LLM loop aborted: task was stopped externally');
        return '';
      }
    }

    return 'I got a bit confused there. Can you try again?';
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'move_to': {
        const x = Number(args.x);
        const y = Number(args.y);
        const z = Number(args.z);
        await this.botManager.moveTo(x, y, z);
        return `Arrived at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}).`;
      }

      case 'follow_player': {
        const username = String(args.username);
        const distance =
          args.distance !== undefined
            ? Math.min(16, Math.max(1, Math.floor(Number(args.distance))))
            : 3;
        this.botManager.followPlayer(username, distance);
        return `Now following ${username} at distance ${distance}.`;
      }

      case 'mine_area': {
        const from = { x: Number(args.x1), y: Number(args.y1), z: Number(args.z1) };
        const to = { x: Number(args.x2), y: Number(args.y2), z: Number(args.z2) };
        const result = await this.botManager.mineArea(from, to);
        return `Mining complete. Mined: ${result.minedBlocks}, skipped: ${result.skippedBlocks}.`;
      }

      case 'stop_movement': {
        this.botManager.stopMovement();
        return 'Stopped all movement and mining.';
      }

      case 'send_chat': {
        const message = String(args.message);
        this.botManager.chat(message);
        return `Sent message: "${message}".`;
      }

      case 'get_status': {
        const state = this.botManager.getState();
        if (!state) {
          return 'Bot is not ready or not spawned yet.';
        }
        return (
          `Position: (${Math.floor(state.position.x)}, ${Math.floor(state.position.y)}, ${Math.floor(state.position.z)}), ` +
          `health: ${state.health}/20, food: ${state.food}/20, dimension: ${state.dimension}.`
        );
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }
}
