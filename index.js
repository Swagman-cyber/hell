require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// ========== DATABASE SETUP ==========
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('📦 Database connected');
    db.serialize(() => {
      db.all("PRAGMA table_info(usedCodes);", (err, rows) => {
        if (err) {
          console.error("❌ Error getting table info:", err);
          return;
        }

        if (!rows.length || !rows.some(row => row.name === 'robloxId')) {
          console.log('❌ Invalid table structure. Recreating the table...');
          db.run('DROP TABLE IF EXISTS usedCodes');
          db.run('CREATE TABLE usedCodes (code TEXT PRIMARY KEY, robloxId TEXT)', (err) => {
            if (err) console.error('❌ Error creating usedCodes table:', err);
            else console.log('✅ usedCodes table recreated.');
          });
        } else {
          console.log('✅ usedCodes table is valid.');
        }
      });
    });
  }
});

// ========== EXPRESS SERVER ==========
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 Server running at http://0.0.0.0:${port}`);
});

// ========== DISCORD BOT SETUP ==========
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map(); // userId => { robloxId, code }

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ========== SLASH COMMAND REGISTRATION ==========
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Begin Roblox verification')
      .addStringOption(option =>
        option.setName('username')
          .setDescription('Your Roblox username')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('confirm')
      .setDescription('Confirm that you added the code to your Roblox About Me'),
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('📡 Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered.');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

// ========== BOT READY ==========
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  if (!guild) {
    console.error("❌ Guild not found. Check your GUILD_ID.");
    process.exit(1);
  }
  console.log(`📌 Connected to guild: ${guild.name}`);
  await registerSlashCommands();
});

// ========== COMMAND HANDLING ==========
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'verify') {
    const robloxUsername = interaction.options.getString('username');
    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) {
        return interaction.reply({ content: '❌ Roblox user not found.', ephemeral: true });
      }

      const robloxId = userData.id;
      const code = generateCode();

      pendingVerifications.set(interaction.user.id, { robloxId, code });

      return interaction.reply({
        content: `✅ Paste this code into your **Roblox About Me**:\n\`\`\`${code}\`\`\`\nThen use \`/confirm\` when you're done.`,
        ephemeral: true
      });
    } catch (error) {
      console.error(error);
      return interaction.reply({ content: '❌ Failed to fetch Roblox user info.', ephemeral: true });
    }
  }

  if (commandName === 'confirm') {
    const entry = pendingVerifications.get(interaction.user.id);
    if (!entry) {
      return interaction.reply({ content: '❗ Use `/verify <username>` first.', ephemeral: true });
    }

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (!description.includes(entry.code)) {
        return interaction.reply({ content: '❌ Verification code not found in your About Me.', ephemeral: true });
      }

      db.get('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?', [entry.code, entry.robloxId], (err, row) => {
        if (err) {
          console.error('❌ DB lookup error:', err);
          return interaction.reply({ content: '❌ DB error checking code.', ephemeral: true });
        }

        if (row) {
          return interaction.reply({ content: '❌ This code was already used.', ephemeral: true });
        }

        db.run('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)', [entry.code, entry.robloxId], (err) => {
          if (err) {
            console.error('❌ DB insert error:', err);
            return interaction.reply({ content: '❌ Error saving code.', ephemeral: true });
          }

          const guild = interaction.guild;
          const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'citizen');
          if (!role) {
            return interaction.reply({ content: '❌ "Citizen" role not found.', ephemeral: true });
          }

          const member = guild.members.cache.get(interaction.user.id);
          if (!member) {
            return interaction.reply({ content: '❌ User not found in guild.', ephemeral: true });
          }

          member.roles.add(role)
            .then(() => {
              pendingVerifications.delete(interaction.user.id);
              interaction.reply({ content: '🎉 Verified! You now have the **Citizen** role!', ephemeral: true });
            })
            .catch(err => {
              console.error(err);
              interaction.reply({ content: '❌ Failed to assign role.', ephemeral: true });
            });
        });
      });
    } catch (err) {
      console.error('❌ Roblox profile check error:', err);
      return interaction.reply({ content: '❌ Error checking your Roblox profile.', ephemeral: true });
    }
  }
});

// ========== LOGIN ==========
client.login(process.env.DISCORD_TOKEN);
