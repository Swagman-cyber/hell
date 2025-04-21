require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Setup SQLite database
const db = new sqlite3.Database('./serverSettings.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Database connected');
    // Ensure serverSettings table exists
    db.run(`
      CREATE TABLE IF NOT EXISTS serverSettings (
        guildId TEXT PRIMARY KEY,
        verificationEnabled BOOLEAN DEFAULT 1,
        verificationRoleName TEXT DEFAULT 'Citizen',
        verificationTimeout INTEGER DEFAULT 86400000,
        verificationMessage TEXT DEFAULT 'Please paste this code into your Roblox About Me to verify yourself.',
        verificationCodeLength INTEGER DEFAULT 6,
        allowUsernameVerification BOOLEAN DEFAULT 1,
        logChannelId TEXT DEFAULT NULL,
        antiSpamEnabled BOOLEAN DEFAULT 1,
        verificationFailedMessage TEXT DEFAULT '❌ Verification failed. Please check your code.',
        verificationSuccessMessage TEXT DEFAULT '🎉 You are now verified!',
        exemptRoles TEXT DEFAULT 'admin, moderator'
      );
    `);
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

// Helper function to get settings for a guild
function getSettings(guildId, callback) {
  db.get('SELECT * FROM serverSettings WHERE guildId = ?', [guildId], (err, row) => {
    if (err) {
      console.error('❌ Error retrieving settings:', err);
      return callback(null);
    }
    return callback(row || {});
  });
}

// Helper function to update settings for a guild
function updateSettings(guildId, newSettings, callback) {
  const { verificationEnabled, verificationRoleName, verificationTimeout, verificationMessage, verificationCodeLength,
          allowUsernameVerification, logChannelId, antiSpamEnabled, verificationFailedMessage, verificationSuccessMessage,
          exemptRoles } = newSettings;

  db.run(
    `INSERT INTO serverSettings (guildId, verificationEnabled, verificationRoleName, verificationTimeout, verificationMessage, 
      verificationCodeLength, allowUsernameVerification, logChannelId, antiSpamEnabled, verificationFailedMessage, 
      verificationSuccessMessage, exemptRoles)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guildId) 
     DO UPDATE SET
     verificationEnabled = ?, verificationRoleName = ?, verificationTimeout = ?, verificationMessage = ?, 
     verificationCodeLength = ?, allowUsernameVerification = ?, logChannelId = ?, antiSpamEnabled = ?, 
     verificationFailedMessage = ?, verificationSuccessMessage = ?, exemptRoles = ?`,
    [guildId, verificationEnabled, verificationRoleName, verificationTimeout, verificationMessage, verificationCodeLength,
     allowUsernameVerification, logChannelId, antiSpamEnabled, verificationFailedMessage, verificationSuccessMessage, exemptRoles,
     verificationEnabled, verificationRoleName, verificationTimeout, verificationMessage, verificationCodeLength,
     allowUsernameVerification, logChannelId, antiSpamEnabled, verificationFailedMessage, verificationSuccessMessage, exemptRoles],
    (err) => {
      if (err) {
        console.error('❌ Error updating settings:', err);
        return callback(false);
      }
      return callback(true);
    }
  );
}

// Command handler
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // Step 1: View current settings
  if (command === '!settings' && message.member.permissions.has('ADMINISTRATOR')) {
    getSettings(message.guild.id, (settings) => {
      const embed = new EmbedBuilder()
        .setTitle('Server Settings')
        .setDescription(`
          **Verification Enabled:** ${settings.verificationEnabled ? 'Enabled' : 'Disabled'}
          **Verification Role:** ${settings.verificationRoleName}
          **Verification Timeout:** ${settings.verificationTimeout / 1000 / 60 / 60} hours
          **Verification Code Length:** ${settings.verificationCodeLength} characters
          **Allow Username Verification:** ${settings.allowUsernameVerification ? 'Enabled' : 'Disabled'}
          **Anti-Spam:** ${settings.antiSpamEnabled ? 'Enabled' : 'Disabled'}
          **Log Channel ID:** ${settings.logChannelId ? settings.logChannelId : 'Not set'}
        `)
        .setColor('#4CAF50');

      message.reply({ embeds: [embed] });
    });
  }

  // Step 2: Update verification settings
  if (command === '!setvermessage' && message.member.permissions.has('ADMINISTRATOR')) {
    const newMessage = args.slice(1).join(' ');
    if (!newMessage) {
      return message.reply('❗ Please provide a verification message.');
    }

    getSettings(message.guild.id, (settings) => {
      settings.verificationMessage = newMessage;
      updateSettings(message.guild.id, settings, (success) => {
        if (success) {
          message.reply(`✅ Verification message updated to: ${newMessage}`);
        } else {
          message.reply('❌ Failed to update verification message.');
        }
      });
    });
  }

  // Enable/Disable Anti-Spam
  if (command === '!toggleantispam' && message.member.permissions.has('ADMINISTRATOR')) {
    getSettings(message.guild.id, (settings) => {
      settings.antiSpamEnabled = settings.antiSpamEnabled ? 0 : 1;
      updateSettings(message.guild.id, settings, (success) => {
        if (success) {
          message.reply(`✅ Anti-spam has been ${settings.antiSpamEnabled ? 'enabled' : 'disabled'}.`);
        } else {
          message.reply('❌ Failed to update anti-spam setting.');
        }
      });
    });
  }

  // Set Verification Role Name
  if (command === '!setverrole' && message.member.permissions.has('ADMINISTRATOR')) {
    const newRoleName = args.slice(1).join(' ');
    if (!newRoleName) {
      return message.reply('❗ Please provide a role name.');
    }

    getSettings(message.guild.id, (settings) => {
      settings.verificationRoleName = newRoleName;
      updateSettings(message.guild.id, settings, (success) => {
        if (success) {
          message.reply(`✅ Verification role name updated to: ${newRoleName}`);
        } else {
          message.reply('❌ Failed to update verification role name.');
        }
      });
    });
  }

  // Set Custom Error Messages
  if (command === '!setverfailmessage' && message.member.permissions.has('ADMINISTRATOR')) {
    const newFailMessage = args.slice(1).join(' ');
    if (!newFailMessage) {
      return message.reply('❗ Please provide a failure message.');
    }

    getSettings(message.guild.id, (settings) => {
      settings.verificationFailedMessage = newFailMessage;
      updateSettings(message.guild.id, settings, (success) => {
        if (success) {
          message.reply(`✅ Verification failure message updated.`);
        } else {
          message.reply('❌ Failed to update failure message.');
        }
      });
    });
  }

  if (command === '!setversuccessmessage' && message.member.permissions.has('ADMINISTRATOR')) {
    const newSuccessMessage = args.slice(1).join(' ');
    if (!newSuccessMessage) {
      return message.reply('❗ Please provide a success message.');
    }

    getSettings(message.guild.id, (settings) => {
      settings.verificationSuccessMessage = newSuccessMessage;
      updateSettings(message.guild.id, settings, (success) => {
        if (success) {
          message.reply(`✅ Verification success message updated.`);
        } else {
          message.reply('❌ Failed to update success message.');
        }
      });
    });
  }

  // Enable/Disable Verification
  if (command === '!toggleverification' && message.member.permissions.has('ADMINISTRATOR')) {
    getSettings(message.guild.id, (settings) => {
      settings.verificationEnabled = settings.verificationEnabled ? 0 : 1;
      updateSettings(message.guild.id, settings, (success) => {
        if (success) {
          message.reply(`✅ Verification system has been ${settings.verificationEnabled ? 'enabled' : 'disabled'}.`);
        } else {
          message.reply('❌ Failed to update verification setting.');
        }
      });
    });
  }

  // Additional settings can be added similarly, such as setting timeout or role exemption.
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
