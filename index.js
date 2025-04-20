require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// === Express Uptime Ping ===
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(3000, () => console.log('🌐 Web server running.'));

// === SQLite Setup ===
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('❌ Failed to open database:', err.message);
    process.exit(1);
  }

  console.log('✅ SQLite connected.');
  db.run(`CREATE TABLE IF NOT EXISTS usedCodes (
    code TEXT PRIMARY KEY,
    robloxId TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS verifiedRoles (
    guildId TEXT,
    roleId TEXT,
    PRIMARY KEY (guildId, roleId)
  )`);
});

// === Bot Setup ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map();

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // === Admin: Opt In Role ===
  if (command === '!optinrole') {
    if (!message.member.permissions.has('Administrator')) return message.reply('❌ Only admins can use this.');

    const roleId = args[1]?.match(/\d+/)?.[0];
    const role = message.guild.roles.cache.get(roleId);
    if (!role) return message.reply('❗ Usage: `!optinrole @Role`');

    db.run(`INSERT OR IGNORE INTO verifiedRoles (guildId, roleId) VALUES (?, ?)`, [message.guild.id, role.id], (err) => {
      if (err) {
        console.error('❌ DB error in optinrole:', err);
        return message.reply('❌ Failed to save the verified role.');
      }
      message.reply(`✅ **${role.name}** is now a verified role.`);
    });
  }

  // === Admin: Opt Out Role ===
  if (command === '!optoutrole') {
    if (!message.member.permissions.has('Administrator')) return message.reply('❌ Only admins can use this.');

    const roleId = args[1]?.match(/\d+/)?.[0];
    const role = message.guild.roles.cache.get(roleId);
    if (!role) return message.reply('❗ Usage: `!optoutrole @Role`');

    db.run(`DELETE FROM verifiedRoles WHERE guildId = ? AND roleId = ?`, [message.guild.id, role.id], (err) => {
      if (err) {
        console.error('❌ DB error in optoutrole:', err);
        return message.reply('❌ Failed to remove the verified role.');
      }
      message.reply(`✅ **${role.name}** is no longer a verified role.`);
    });
  }

  // === User: Start Verification ===
  if (command === '!verify') {
    const username = args[1];
    if (!username) return message.reply('❗ Usage: `!verify <RobloxUsername>`');

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [username],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ User not found.');

      const robloxId = userData.id;
      const code = generateCode();
      pendingVerifications.set(message.author.id, { robloxId, code });

      message.reply(
        `✅ Paste this code into your **Roblox About Me**:\n\`\`\`${code}\`\`\`\nThen type \`!confirm\` when you're done.`
      );
    } catch (err) {
      console.error(err);
      message.reply('❌ Failed to get Roblox user.');
    }
  }

  // === User: Confirm Code ===
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ Use `!verify <username>` first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (!description.includes(entry.code)) {
        return message.reply('❌ Code not found in your profile. Double-check your About Me.');
      }

      // Check reuse
      db.get(`SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?`, [entry.code, entry.robloxId], (err, row) => {
        if (err) {
          console.error('❌ DB lookup error:', err);
          return message.reply('❌ DB error. Please try again later.');
        }

        if (row) {
          return message.reply('❌ Code already used.');
        }

        // Store it
        db.run(`INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)`, [entry.code, entry.robloxId], async (err) => {
          if (err) {
            console.error('❌ DB insert error:', err);
            return message.reply('❌ DB error while saving your verification.');
          }

          const member = message.guild.members.cache.get(message.author.id);

          db.all(`SELECT roleId FROM verifiedRoles WHERE guildId = ?`, [message.guild.id], async (err, rows) => {
            if (err) {
              console.error('❌ DB role fetch error:', err);
              return message.reply('❌ Failed to get roles.');
            }

            let roleAssigned = false;

            // Try verifiedRoles first
            for (const row of rows) {
              const role = message.guild.roles.cache.get(row.roleId);
              if (role) {
                await member.roles.add(role).catch(console.error);
                roleAssigned = true;
                break;
              }
            }

            // If no opted-in roles, fallback to "Citizen"
            if (!roleAssigned) {
              let fallback = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'citizen');

              if (!fallback) {
                try {
                  fallback = await message.guild.roles.create({
                    name: 'Citizen',
                    color: 'Blue',
                    reason: 'Default verified role created by bot',
                  });
                  console.log('✅ Fallback role "Citizen" created.');
                } catch (e) {
                  console.error('❌ Failed to create fallback role:', e);
                  return message.reply('❌ Failed to assign a verified role and couldn’t create "Citizen".');
                }
              }

              await member.roles.add(fallback).catch(console.error);
              roleAssigned = true;
            }

            if (roleAssigned) {
              pendingVerifications.delete(message.author.id);
              message.reply('🎉 You are verified!');
            } else {
              message.reply('❌ Something went wrong. Please contact a server admin.');
            }
          });
        });
      });
    } catch (err) {
      console.error('❌ API Error:', err);
      message.reply('❌ Error checking your Roblox profile.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
