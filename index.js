client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // Step 1: !verify <username>
  if (command === '!verify') {
    if (!verificationEnabled) {
      return message.reply('❌ Verification is currently disabled.');
    }

    const robloxUsername = args[1];
    if (!robloxUsername) {
      return message.reply('❗ Please provide your Roblox username. Usage: !verify <username>');
    }

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ Roblox user not found.');

      const robloxId = userData.id;
      const robloxProfileUrl = `https://www.roblox.com/users/${robloxId}/profile`;
      const code = generateCode();

      // Fetch the profile image URL using Roblox Thumbnails API
      const profileImageUrl = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=420x420&format=Png&isCircular=false`;
      
      pendingVerifications.set(message.author.id, { robloxId, code });

      // Send instructions with rich embed and profile image
      const embed = new EmbedBuilder()
        .setTitle('Roblox Verification')
        .setDescription(`✅ **Paste this code into your Roblox About Me:**\n\`${code}\`\nThen type \`!confirm\` when you're done.`)
        .setColor('Green')
        .setThumbnail(profileImageUrl)  // Display profile image
        .setURL(robloxProfileUrl);

      return message.reply({ embeds: [embed] });

    } catch (error) {
      console.error(error);
      return message.reply('❌ Failed to fetch Roblox user info.');
    }
  }

  // Step 2: !confirm
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ You need to use !verify <username> first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      // Check if the verification code exists in the About Me
      if (description.includes(entry.code)) {
        // Check if the code has already been used in the database
        db.get('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?', [entry.code, entry.robloxId], (err, row) => {
          if (err) {
            console.error('❌ DB lookup error:', err);
            return message.reply('❌ Error checking code in the database.');
          }

          if (row) {
            return message.reply('❌ This code has already been used or is invalid.');
          }

          // Add the code to the usedCodes table to prevent reuse
          db.run('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)', [entry.code, entry.robloxId], (err) => {
            if (err) {
              console.error('❌ DB insert error:', err);
              return message.reply('❌ Error storing code in the database.');
            }

            // Assign the "Citizen" role
            const guild = message.guild;
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'citizen');

            if (!role) {
              return message.reply('❌ The "Citizen" role does not exist in the server. Please create it.');
            }

            const member = guild.members.cache.get(message.author.id);
            if (!member) {
              return message.reply('❌ Failed to find your Discord account in the server.');
            }

            member.roles.add(role)
              .then(() => {
                pendingVerifications.delete(message.author.id); // Invalidate the code
                message.reply('🎉 You are now verified and have been given the **Citizen** role!');
              })
              .catch((err) => {
                console.error(err);
                message.reply('❌ Failed to assign role.');
              });
          });
        });
      } else {
        return message.reply('❌ Verification code not found in your profile. Double-check your About Me.');
      }
    } catch (err) {
      console.error('❌ Error while checking your Roblox profile:', err);
      return message.reply('❌ Error while checking your Roblox profile.');
    }
  }
});
