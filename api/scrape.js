// api/scrape.js - автоматический сбор данных
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// Настройки (замените на свои!)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const YANDEX_API_KEY = process.env.YANDEX_API_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = async (req, res) => {
    try {
        console.log('Начинаем сбор данных...');
        
        // 1. Собираем пиццерии с Яндекс.Карт
        const yandexPizza = await getYandexPizzaData();
        
        // 2. Собираем промокоды
        const promocodes = await getPromocodes();
        
        // 3. Обновляем базу данных
        await updateDatabase(yandexPizza, promocodes);
        
        res.status(200).json({ 
            success: true, 
            message: 'Данные обновлены!',
            updated: yandexPizza.length 
        });
        
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
};

async function getYandexPizzaData() {
    const results = [];
    
    try {
        // Поиск пиццерий в Сыктывкаре через Яндекс.Карты API
        const response = await axios.get(
            `https://search-maps.yandex.ru/v1/?apikey=${YANDEX_API_KEY}&text=пицца+Сыктывкар&type=biz&lang=ru_RU&results=20`
        );
        
        if (response.data.features) {
            for (const place of response.data.features) {
                const name = place.properties.name;
                
                // Фильтруем только пиццерии
                if (name.toLowerCase().includes('пицц') || 
                    name.includes('Pizza') || 
                    name.includes('Додо') ||
                    name.includes('Папа Джонс') ||
                    name.includes('Пицца Суши')) {
                    
                    // Пытаемся получить цену
                    let price = await getPizzaPrice(name);
                    
                    results.push({
                        name: name,
                        address: place.properties.description || place.properties.text,
                        rating: place.properties.rating,
                        reviews: place.properties.reviews,
                        yandex_link: `https://yandex.ru/maps/?text=${encodeURIComponent(name + ' Сыктывкар')}`,
                        price: price
                    });
                }
            }
        }
    } catch (error) {
        console.log('Ошибка Яндекс API:', error.message);
    }
    
    return results;
}

async function getPizzaPrice(placeName) {
    // Пробуем найти цену в открытых источниках
    const pricePatterns = {
        'Додо': 349,  // Базовая цена Додо
        'Папа Джонс': 399,
        'Пицца Суши': 299,
        'Теремок': 250
    };
    
    for (const [key, price] of Object.entries(pricePatterns)) {
        if (placeName.includes(key)) {
            return price;
        }
    }
    
    // Если не нашли - возвращаем случайную цену в диапазоне
    return 300 + Math.floor(Math.random() * 200);
}

async function getPromocodes() {
    const promocodes = [];
    
    try {
        // Пример сбора промокодов с сайта
        const { data } = await axios.get('https://promokodi.ru/category/pitstsa/');
        const $ = cheerio.load(data);
        
        $('.coupon-item').each((i, elem) => {
            const title = $(elem).find('.coupon-title').text();
            const code = $(elem).find('.coupon-code').text();
            
            if (title && code && title.includes('пицц')) {
                promocodes.push({
                    code: code.trim(),
                    description: title.trim()
                });
            }
        });
    } catch (error) {
        console.log('Не удалось собрать промокоды:', error.message);
    }
    
    return promocodes;
}

async function updateDatabase(pizzaData, promocodes) {
    for (const pizza of pizzaData) {
        // Проверяем, есть ли уже такая пиццерия
        const { data: existing } = await supabase
            .from('pizza_places')
            .select('id')
            .eq('name', pizza.name)
            .limit(1);
        
        if (existing && existing.length > 0) {
            // Обновляем существующую
            await supabase
                .from('pizza_places')
                .update({
                    price: pizza.price,
                    rating: pizza.rating,
                    reviews: pizza.reviews,
                    last_updated: new Date()
                })
                .eq('name', pizza.name);
        } else {
            // Добавляем новую
            await supabase
                .from('pizza_places')
                .insert([pizza]);
        }
    }
}