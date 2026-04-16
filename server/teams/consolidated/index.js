/**
 * Consolidated Teams Tools Export
 * 
 * This module exports the consolidated Teams tools:
 * - teams_meeting: All meeting operations
 * - teams_channel: All channel operations
 * - teams_chat: All chat operations
 * 
 * Each tool is operation-based, providing a unified interface
 * for all Teams functionality.
 */

const handleTeamsMeeting = require('./teams_meeting');
const handleTeamsChannel = require('./teams_channel');
const handleTeamsChat = require('./teams_chat');
const { safeTool } = require('../../utils/errors');

// Define the tool schemas
const meetingToolSchema = {
  type: 'object',
  required: ['operation'],
  properties: {
    operation: {
      type: 'string',
      description: 'The operation to perform',
      enum: [
        'create', 'update', 'cancel', 'get', 'find_by_url',
        'list_transcripts', 'get_transcript', 'list_recordings', 
        'get_recording', 'get_participants', 'get_insights'
      ]
    }
  }
};

const channelToolSchema = {
  type: 'object',
  required: ['operation'],
  properties: {
    operation: {
      type: 'string',
      description: 'The operation to perform',
      enum: [
        'list', 'create', 'get', 'update', 'delete',
        'list_messages', 'get_message', 'create_message', 'reply_to_message',
        'list_members', 'add_member', 'remove_member', 'list_tabs'
      ]
    }
  }
};

const chatToolSchema = {
  type: 'object',
  required: ['operation'],
  properties: {
    operation: {
      type: 'string',
      description: 'The operation to perform',
      enum: [
        'list', 'create', 'get', 'update', 'delete',
        'list_messages', 'get_message', 'send_message', 'update_message', 'delete_message',
        'list_members', 'add_member', 'remove_member'
      ]
    },
    members: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array of member emails or user IDs (for create). Required for create.'
    },
    topic: {
      type: 'string',
      description: 'Chat topic/name (for create group chats, update)'
    },
    chatId: {
      type: 'string',
      description: 'Chat ID (for get, update, delete, message operations, member operations)'
    },
    content: {
      type: 'string',
      description: 'Message content (for send_message)'
    },
    messageId: {
      type: 'string',
      description: 'Message ID (for get_message, update_message, delete_message)'
    },
    replyToId: {
      type: 'string',
      description: 'Message ID to reply to (for send_message)'
    },
    mentions: {
      type: 'array',
      description: 'Array of mention objects for send_message / update_message — REQUIRED when tagging people. Bolding a name (<b>Name</b>) is NOT a mention: it renders bold text but fires zero notifications and carries no identifier. To actually ping someone you must (a) pass a mentions array entry with their AAD user id and (b) include a matching <at id="N">DisplayName</at> tag in the HTML content — the id must match on both sides. Get AAD ids via the directory tool (lookup_user). Each item shape: { id: number, mentionText: string, mentioned: { user: { id: string, displayName: string, userIdentityType: "aadUser" } } }. Edit-vs-notify: update_message preserves mentions if re-passed, but never re-triggers Teams notifications — if the first send missed the mentions, the recovery is to update the original AND send a short fresh follow-up with mentions to actually ping.',
      items: { type: 'object' }
    },
    userId: {
      type: 'string',
      description: 'User ID to add (for add_member)'
    },
    email: {
      type: 'string',
      description: 'Email of user to add (for add_member)'
    },
    memberId: {
      type: 'string',
      description: 'Member ID to remove (for remove_member)'
    },
    maxResults: {
      type: 'number',
      description: 'Max results to return (for list, list_messages)'
    }
  }
};

// Export the tools
module.exports = [
  {
    name: 'teams_meeting',
    description: 'Teams meeting operations: create, update, cancel, find, list transcripts, get recordings, and more',
    inputSchema: meetingToolSchema,
    handler: safeTool('teams_meeting', handleTeamsMeeting)
  },
  {
    name: 'teams_channel',
    description: 'Teams channel operations: list, create, get, update, delete channels and manage messages, members, and tabs',
    inputSchema: channelToolSchema,
    handler: safeTool('teams_channel', handleTeamsChannel)
  },
  {
    name: 'teams_chat',
    description: 'Teams chat operations: list, create, get, update, delete chats and manage messages and members',
    inputSchema: chatToolSchema,
    handler: safeTool('teams_chat', handleTeamsChat)
  }
];