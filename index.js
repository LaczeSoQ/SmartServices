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
    // รองรับ 3 API Keys แล้วครับ
    const apiKeys = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3
    ].filter(Boolean);

    if (apiKeys.length === 0) {
        throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment Variables ของ Render");
    }

    let lastError = null;
    for (let i = 0; i < apiKeys.length; i++) {
        try {
            console.log(`กำลังเรียกใช้งาน Gemini API ด้วย Key ที่ ${i + 1}...`);
            const genAI = new GoogleGenerativeAI(apiKeys[i]);
            const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });
            const result = await model.generateContent(promptText);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.warn(`⚠️ Key ที่ ${i + 1} ล้มเหลว:`, error.message);
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
                botMessage: null,
                isConfirmed: false,
                summaryMessage: null,
                currentSummary: null
            };
            postDataMap.set(threadId, postData);

            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_summary')
                    .setLabel('✅ ยืนยันข้อมูลและสรุปงาน')
                    .setStyle(ButtonStyle.Success)
            );

            postData.botMessage = await message.reply({
                content: `📌 **ข้อมูลครบหรือยัง?** กดยืนยันด้านล่างได้เลย (หากมีเพิ่มพิมพ์ส่งมาได้ครับ)`,
                components: [confirmRow]
            });
        } else {
            if (postData.isConfirmed) {
                try {
                    await message.react('🔄');

                    const updatePrompt = `ข้อมูลสรุปเดิม:
- ชื่อบริษัทลูกค้า: ${postData.currentSummary.companyName}
- ชื่อลูกค้า: ${postData.currentSummary.customerName}
- ประเภทงาน: ${postData.currentSummary.jobType}
- รายละเอียดงาน: ${postData.currentSummary.jobDetails}

ข้อความแก้ไขหรือเพิ่มติมที่ส่งมาใหม่: "${message.content}"

จงอัปเดตข้อมูลทั้งหมดให้สอดคล้องกับข้อความใหม่ โดยคงค่าเดิมไว้หากไม่มีการพูดถึงการเปลี่ยนแปลง และจัดรูปแบบการตอบดังนี้:
- ชื่อบริษัทลูกค้า: [ระบุชื่อบริษัท/ชื่อย่อ]
- ชื่อลูกค้า: [ระบุชื่อลูกค้า]
- ประเภทงาน: [ทำใหม่ หรือ แก้ไข]
- รายละเอียดงาน: [ระบุรายละเอียดงาน]`;

                    const aiResponse = await callGeminiWithFallback(updatePrompt);

                    let companyName = postData.currentSummary.companyName;
                    let customerName = postData.currentSummary.customerName;
                    let jobType = postData.currentSummary.jobType;
                    let jobDetails = postData.currentSummary.jobDetails;

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
                        await message.channel.setName(newThreadName);
                    } catch (error) {
                        console.error('ไม่สามารถเปลี่ยนชื่อ Thread ได้:', error);
                    }

                    const employeeName = message.member ? message.member.displayName : message.author.username;

                    const updatedEmbed = new EmbedBuilder()
                        .setTitle('📋 สรุปข้อมูลงาน')
                        .setColor(0x00FF00)
                        .addFields(
                            { name: '🏢 ชื่อบริษัทลูกค้า', value: companyName, inline: false },
                            { name: '👤 ชื่อลูกค้า', value: customerName, inline: false },
                            { name: '👨‍💻 ชื่อพนักงาน (ผู้บันทึก)', value: employeeName, inline: false },
                            { name: '📌 ประเภทงาน', value: jobType, inline: false },
                            { name: '⚙️ รายละเอียดงาน', value: jobDetails, inline: false }
                        )
                        .setTimestamp();

                    if (postData.summaryMessage) {
                        await postData.summaryMessage.edit({ embeds: [updatedEmbed] }).catch(() => {});
                    }

                    postData.currentSummary = { companyName, customerName, jobType, jobDetails };

                    await message.reactions.removeAll().catch(() => {});
                    await message.react('✅').catch(() => {});

                } catch (err) {
                    console.error("Update Error:", err);
                    await message.react('❌').catch(() => {});
                }
            } else {
                postData.contents.push(message.content);
            }
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'confirm_summary') {
        const threadId = interaction.channel.id;
        const postData = postDataMap.get(threadId);

        if (!postData) {
            return interaction.reply({ 
                content: '❌ ไม่พบข้อมูลโพสต์นี้ในระบบ กรุณาลองใหม่อีกครั้ง', 
                ephemeral: true 
            });
        }

        if (interaction.user.id !== postData.ownerId) {
            return interaction.reply({ 
                content: '❌ เฉพาะเจ้าของโพสต์เท่านั้นที่มีสิทธิ์กดยืนยันครับ', 
                ephemeral: true 
            });
        }

        await interaction.deferUpdate();

        if (postData.botMessage) {
            await postData.botMessage.edit({
                content: `⏳ **กำลังประมวลผล...**`,
                components: []
            }).catch(() => {});
        }

        const fullContent = postData.contents.join('\n');

        try {
            const prompt = `วิเคราะห์โพสต์งานโรงกลึงนี้: "${fullContent}"
วิเคราะห์และดึงข้อมูลตามเงื่อนไขนี้อย่างเคร่งครัด:
1. ชื่อบริษัทลูกค้า: มักเป็นตัวย่อ/ชื่อย่อ (เช่น CGS)
2. ชื่อลูกค้า: มักจะมีคำว่า "k.", "คุณ", หรือชื่อบุคคลต่อท้ายชื่อบริษัท (เช่น k.สาคร, คุณสาคร, ช่างสาคร) ห้ามสับสนกับชื่อบริษัท
3. ประเภทงาน: ระบุว่าเป็น "ทำใหม่" หรือ "แก้ไข"
4. รายละเอียดงาน: หากมีคำว่า "ตามตัวอย่าง", "ตาม ตย.", "ตามรูป", "ตามไฟล์แนบ" ให้สรุปว่าอ้างอิงรายละเอียดตามรูปภาพตัวอย่างที่แนบมาด้วย

จัดรูปแบบการตอบดังนี้:
- ชื่อบริษัทลูกค้า: [ระบุชื่อบริษัท/ชื่อย่อ]
- ชื่อลูกค้า: [ระบุชื่อลูกค้า]
- ประเภทงาน: [ทำใหม่ หรือ แก้ไข]
- รายละเอียดงาน: [ระบุรายละเอียดงาน]`;

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
                .setTitle('📋 สรุปข้อมูลงาน')
                .setColor(0x00FF00)
                .addFields(
                    { name: '🏢 ชื่อบริษัทลูกค้า', value: companyName, inline: false },
                    { name: '👤 ชื่อลูกค้า', value: customerName, inline: false },
                    { name: '👨‍💻 ชื่อพนักงาน (ผู้บันทึก)', value: employeeName, inline: false },
                    { name: '📌 ประเภทงาน', value: jobType, inline: false },
                    { name: '⚙️ รายละเอียดงาน', value: jobDetails, inline: false }
                )
                .setTimestamp();

            const summaryEmbedMsg = await interaction.channel.send({ embeds: [summaryEmbed] });

            if (postData.botMessage) {
                await postData.botMessage.edit({
                    content: `✅ **ยืนยันและสรุปข้อมูลเรียบร้อยแล้วโดยคุณ ${employeeName}**`,
                    components: []
                }).catch(() => {});
            }

            postData.isConfirmed = true;
            postData.summaryMessage = summaryEmbedMsg;
            postData.currentSummary = { companyName, customerName, jobType, jobDetails };

        } catch (err) {
            console.error("Summary Error:", err);
            
            await interaction.followUp({ 
                content: `❌ เกิดข้อผิดพลาด: ${err.message}`, 
                ephemeral: true 
            });

            if (postData.botMessage) {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_summary')
                        .setLabel('✅ ยืนยันข้อมูลและสรุปงาน')
                        .setStyle(ButtonStyle.Success)
                );
                await postData.botMessage.edit({
                    content: `📌 **ข้อมูลครบหรือยัง?** (ระบบ AI ขัดข้องชั่วคราว สามารถกดยืนยันใหม่อีกครั้งได้เลยครับ)`,
                    components: [confirmRow]
                }).catch(() => {});
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);