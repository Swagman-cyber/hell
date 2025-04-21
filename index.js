require('dotenv').config();
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

// Setup SQLite database
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Database connected');
    // Check and fix table schema if needed
    db.serialize(() => {
      db.all("PRAGMA table_info(usedCodes);", (err, rows) => {
        if (err) {
          console.error("❌ Error getting table info:", err);
          return;
        }

        // If the table is missing or doesn't have 'robloxId', recreate it
        if (!rows.length || !rows.some(row => row.name === 'robloxId')) {
          console.log('❌ Invalid table structure. Recreating the table...');
          db.run('DROP TABLE IF EXISTS usedCodes');
          db.run('CREATE TABLE usedCodes (code TEXT PRIMARY KEY, robloxId TEXT)', (err) => {
            if (err) {
              console.error('❌ Error creating usedCodes table:', err);
            } else {
              console.log('✅ usedCodes table recreated with the correct schema.');
            }
          });
        } else {
          console.log('✅ usedCodes table is valid.');
        }
      });
    });
  }
});

const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map(); // userId => { robloxId, code }

let verificationEnabled = true; // Default state of verification

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Registering Slash Commands
client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  if (!guild) {
    console.error("❌ Guild not found. Check your GUILD_ID in the .env file.");
    process.exit(1);
  }

  console.log(`📌 Connected to guild: ${guild.name}`);

  // Register Slash Commands
  const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('Start the Roblox account verification process'),
    new SlashCommandBuilder().setName('confirm').setDescription('Confirm your Roblox account verification'),
  ];

  await client.application.commands.set(commands, process.env.GUILD_ID); // Register commands for your guild
  console.log('✅ Slash commands registered');
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'verify') {
    if (!verificationEnabled) {
      return interaction.reply('❌ Verification is currently disabled.');
    }

    const robloxUsername = interaction.options.getString('username');
    if (!robloxUsername) {
      return interaction.reply('❗ Please provide your Roblox username. Usage: `/verify <username>`');
    }

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return interaction.reply('❌ Roblox user not found.');

      const robloxId = userData.id;
      const robloxProfileUrl = `https://www.roblox.com/users/${robloxId}/profile`;
      const profileImageUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxId}&width=420&height=420&format=png`;
      const code = generateCode();

      pendingVerifications.set(interaction.user.id, { robloxId, code });

      const embed = {
        title: 'Roblox Verification',
        description: `✅ **Paste this code into your Roblox About Me:**\n\`\`\`${code}\`\`\`\nThen type \`/confirm\` when you're done.`,
        color: 0x00FF00,
        thumbnail: { url: profileImageUrl },
        url: robloxProfileUrl
      };

      return interaction.reply({ embeds: [embed] });

    } catch (error) {
      console.error(error);
      return interaction.reply('❌ Failed to fetch Roblox user info.');
    }
  }

  if (interaction.commandName === 'confirm') {
    const entry = pendingVerifications.get(interaction.user.id);
    if (!entry) return interaction.reply('❗ You need to use `/verify <username>` first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (description.includes(entry.code)) {
        db.get('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?', [entry.code, entry.robloxId], (err, row) => {
          if (err) {
            console.error('❌ DB lookup error:', err);
            return interaction.reply('❌ Error checking code in the database.');
          }

          if (row) {
            return interaction.reply('❌ This code has already been used or is invalid.');
          }

          db.run('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)', [entry.code, entry.robloxId], (err) => {
            if (err) {
              console.error('❌ DB insert error:', err);
              return interaction.reply('❌ Error storing code in the database.');
            }

            // Assign the "Citizen" role
            const guild = interaction.guild;
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'citizen');

            if (!role) {
              return interaction.reply('❌ The "Citizen" role does not exist in the server. Please create it.');
            }

            const member = guild.members.cache.get(interaction.user.id);
            if (!member) {
              return interaction.reply('❌ Failed to find your Discord account in the server.');
            }

            member.roles.add(role)
              .then(() => {
                pendingVerifications.delete(interaction.user.id); // Invalidate the code
                interaction.reply('🎉 You are now verified and have been given the **Citizen** role!');
              })
              .catch((err) => {
                console.error(err);
                interaction.reply('❌ Failed to assign role.');
              });
          });
        });
      } else {
        return interaction.reply('❌ Verification code not found in your profile. Double-check your About Me.');
      }
    } catch (err) {
      console.error('❌ Error while checking your Roblox profile:', err);
      return interaction.reply('❌ Error while checking your Roblox profile.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
