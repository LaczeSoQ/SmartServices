require('dotenv').config();
const express = require('express');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Machining Owner Bot is online!');
});

app.listen(PORT, () => {
    console.log(`Owner Server listening on port ${PORT}`);
});

async function callGeminiWithFallback(promptText) {
    const apiKeys = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2
    ].filter(Boolean);

    if (apiKeys.length === 0) {
        throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY_1 หรือ GEMINI_API_KEY_2 ใน Environment Variables ของ Render");
    }

    let lastError = null;
    for (let i = 0; i < apiKeys.length; i++) {
        try {
            console.log(`กำลังเรียกใช้งาน Gemini API ด้วย Key ที่ ${i + 1}...`);
            const genAI = new GoogleGenerativeAI(apiKeys[i]);
            // ใช้โมเดล gemini-3.8-flash ตามรุ่นล่าสุด
            const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });
            const result = await model.generateContent(promptText);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.warn(`⚠️ Gemini API Key ที่ ${i + 1} ล้มเหลว:`, error.message);
            lastError = error;
        }
    }
    throw new Error(`Gemini API ล้มเหลวทุก Key: ${lastError ? lastError.message : 'Unknown error'}`);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const postDataMap = new Map();

client.once('ready', () => {
    console.log(`Owner Bot Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.isThread()) {
        const threadId = message.channel.id;
        
        let postData = postDataMap.get(threadId);
        if (!postData) {
            postData = {
                ownerId: message.author.id,
                contents: [message.content],
                botMessage: null
            };
            postDataMap.set(threadId, postData);
        } else {
            postData.contents.push(message.content);
        }

        const fullContent = postData.contents.join('\n');

        try {
            const prompt = `วิเคราะห์โพสต์งานโรงกลึงนี้: "${fullContent}"
ตรวจสอบว่ามีข้อมูลครบถ้วนหรือไม่ (ต้องมี: ชื่อบริษัทลูกค้า, ชื่อลูกค้า, ประเภทงานว่า "ทำใหม่" หรือ "แก้ไข", และรายละเอียดงาน เช่น ขนาด วัสดุ จำนวน)
หากข้อมูลไม่ครบ ให้ขึ้นต้นด้วยคำว่า "INCOMPLETE:" ตามด้วยสิ่งที่ขาดหายไปสั้นๆ
หากข้อมูลครบ ให้ขึ้นต้นด้วยคำว่า "COMPLETE:" ตามด้วยข้อมูลในรูปแบบนี้:
- ชื่อบริษัทลูกค้า: [ระบุชื่อบริษัทลูกค้า]
- ชื่อลูกค้า: [ระบุชื่อลูกค้า]
- ประเภทงาน: [ทำใหม่ หรือ แก้ไข]
- รายละเอียดงาน: [ระบุรายละเอียด ขนาด วัสดุ จำนวน]`;

            const aiResponse = await callGeminiWithFallback(prompt);

            if (aiResponse.includes('INCOMPLETE:')) {
                const missingInfo = aiResponse.replace('INCOMPLETE:', '').trim();
                const warningText = `⚠️ **ข้อมูลยังไม่ครบถ้วน:** ขาด (${missingInfo})\n> *กรุณาส่งข้อมูลมาเพิ่ม ระบบจะตรวจสอบให้อัตโนมัติครับ*`;
                
                if (postData.botMessage) {
                    try {
                        await postData.botMessage.edit({ content: warningText, components: [] });
                    } catch (e) {
                        postData.botMessage = await message.reply({ content: warningText });
                    }
                } else {
                    postData.botMessage = await message.reply({ content: warningText });
                }
            } else {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_summary')
                        .setLabel('✅ ยืนยันข้อมูลและสรุปงาน')
                        .setStyle(ButtonStyle.Success)
                );

                const successText = `📌 **AI ตรวจสอบแล้ว:** ข้อมูลครบถ้วนสมบูรณ์!\n> **ถ้าข้อมูลถูกต้องให้กดยืนยันด้านล่าง** (หากยังต้องการแก้ไข พิมพ์ส่งมาเพิ่มได้ครับ)`;

                if (postData.botMessage) {
                    try {
                        await postData.botMessage.edit({ content: successText, components: [confirmRow] });
                    } catch (e) {
                        postData.botMessage = await message.reply({ content: successText, components: [confirmRow] });
                    }
                } else {
                    postData.botMessage = await message.reply({ content: successText, components: [confirmRow] });
                }
            }

        } catch (err) {
            console.error("AI Error:", err);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'confirm_summary') {
        const threadId = interaction.channel.id;
        const postData = postDataMap.get(threadId);

        if (!postData) {
            return interaction.reply({ content: '❌ ไม่พบข้อมูลโพสต์นี้ในระบบ กรุณาลองใหม่อีกครั้ง', ephemeral: true });
        }

        if (interaction.user.id !== postData.ownerId) {
            return interaction.reply({ content: '❌ เฉพาะเจ้าของโพสต์เท่านั้นที่มีสิทธิ์กดยืนยันครับ', ephemeral: true });
        }

        await interaction.deferUpdate();

        const fullContent = postData.contents.join('\n');

        try {
            const prompt = `วิเคราะห์โพสต์งานโรงกลึงนี้: "${fullContent}"
ดึงข้อมูลตามรูปแบบนี้:
- ชื่อบริษัทลูกค้า: [ระบุชื่อบริษัทลูกค้า]
- ชื่อลูกค้า: [ระบุชื่อลูกค้า]
- ประเภทงาน: [ทำใหม่ หรือ แก้ไข]
- รายละเอียดงาน: [ระบุรายละเอียด ขนาด วัสดุ จำนวน]`;

            const aiResponse = await callGeminiWithFallback(prompt);

            const employeeName = interaction.member ? interaction.member.displayName : interaction.user.username;

            let companyName = "ไม่ระบุชื่อบริษัท";
            let customerName = "ไม่ระบุชื่อลูกค้า";
            let jobType = "ทำใหม่";
            let jobDetails = fullContent;

            const companyMatch = aiResponse.match(/- ชื่อบริษัทลูกค้า:\s*(.*)/);
            const customerMatch = aiResponse.match(/- ชื่อลูกค้า:\s*(.*)/);
            const typeMatch = aiResponse.match(/- ประเภทงาน:\s*(.*)/);
            const detailsMatch = aiResponse.match(/- รายละเอียดงาน:\s*([\s\S]*)/);

            if (companyMatch) companyName = companyMatch[1].trim();
            if (customerMatch) customerName = customerMatch[1].trim();
            if (typeMatch) jobType = typeMatch[1].trim();
            if (detailsMatch) jobDetails = detailsMatch[1].trim();

            const currentDate = new Date().toISOString().split('T')[0];
            const newThreadName = `${currentDate} - ${companyName}`;

            try {
                await interaction.channel.setName(newThreadName);
            } catch (error) {
                console.error('ไม่สามารถเปลี่ยนชื่อ Thread ได้:', error);
            }

            const summaryEmbed = new EmbedBuilder()
                .setTitle('📋 สรุปข้อมูลงานโรงกลึง')
                .setColor(0x00FF00)
                .addFields(
                    { name: '🏢 ชื่อบริษัทลูกค้า', value: companyName, inline: false },
                    { name: '👤 ชื่อลูกค้า', value: customerName, inline: false },
                    { name: '👨‍💻 ชื่อพนักงาน (ผู้บันทึก)', value: employeeName, inline: false },
                    { name: '📌 ประเภทงาน', value: jobType, inline: false },
                    { name: '⚙️ รายละเอียดงาน', value: jobDetails, inline: false }
                )
                .setTimestamp();

            await interaction.channel.send({ embeds: [summaryEmbed] });

            if (postData.botMessage) {
                await postData.botMessage.edit({
                    content: `✅ **ยืนยันและสรุปข้อมูลเรียบร้อยแล้วโดยคุณ ${employeeName}**`,
                    components: []
                }).catch(() => {});
            }

        } catch (err) {
            console.error("Summary Error:", err);
            await interaction.followUp({ content: `❌ เกิดข้อผิดพลาด: ${err.message}`, ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);