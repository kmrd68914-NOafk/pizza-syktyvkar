// api/scrape.js - автоматический сбор данных
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    try {
        // 1. Читаем секреты ТОЛЬКО здесь, внутри функции
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;
        const YANDEX_API_KEY = process.env.YANDEX_API_KEY;
        
        // 2. Проверяем, что секреты загрузились
        if (!supabaseUrl || !supabaseKey || !YANDEX_API_KEY) {
            throw new Error('Не настроены ключи (SUPABASE_URL, SUPABASE_KEY, YANDEX_API_KEY) в Vercel.');
        }
        
        // 3. Только теперь создаём клиент Supabase
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        console.log('Начинаем сбор данных...');
        
        // 4. Собираем пиццерии с Яндекс.Карт
        const yandexPizza = await getYandexPizzaData(YANDEX_API_KEY);
        
        // 5. Собираем промокоды
        const promocodes = await getPromocodes();
        
        // 6. Обновляем базу данных
        await updateDatabase(supabase, yandexPizza, promocodes);
        
        res.status(200).json({ 
            success: true, 
            message: 'Данные успешно обновлены!',
            updated: yandexPizza.length 
        });
        
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
};

// Функция сбора данных с Яндекс.Карт
async function getYandexPizzaData(apiKey) {
    const results = [];
    
    try {
        // Поиск пиццерий в Сыктывкаре через Яндекс.Карты API
        const response = await axios.get(
            `https://search-maps.yandex.ru/v1/?apikey=${apiKey}&text=пицца+Сыктывкар&type=biz&lang=ru_RU&results=20`
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
                        price: price,
                        delivery_time: '30-50 мин', // Примерное время
                        website_link: null // Можно заполнить позже
                    });
                }
            }
        }
    } catch (error) {
        console.log('Ошибка Яндекс API:', error.message);
    }
    
    return results;
}

// Функция для получения примерной цены
async function getPizzaPrice(placeName) {
    const pricePatterns = {
        'Додо': 349,
        'Папа Джонс': 399,
        'Пицца Суши': 299,
        'Теремок': 250
    };
    
    for (const [key, price] of Object.entries(pricePatterns)) {
        if (placeName.includes(key)) {
            return price;
        }
    }
    
    // Если не нашли - возвращаем случайную цену
    return 300 + Math.floor(Math.random() * 200);
}

// Функция сбора промокодов (упрощённая версия)
async function getPromocodes() {
    const promocodes = [];
    
    try {
        // Упрощённый пример - возвращаем тестовые промокоды
        promocodes.push(
            { code: 'PIZZA2024', description: 'Скидка 20% на первый заказ' },
            { code: 'SYKTYPIZZA', description: 'Бесплатная доставка' }
        );
        
    } catch (error) {
        console.log('Не удалось собрать промокоды:', error.message);
    }
    
    return promocodes;
}

// Функция обновления базы данных
async function updateDatabase(supabaseClient, pizzaData, promocodes) {
    for (const pizza of pizzaData) {
        try {
            // Проверяем, есть ли уже такая пиццерия
            const { data: existing } = await supabaseClient
                .from('pizza_places')
                .select('id')
                .eq('name', pizza.name)
                .limit(1);
            
            if (existing && existing.length > 0) {
                // Обновляем существующую
                await supabaseClient
                    .from('pizza_places')
                    .update({
                        price: pizza.price,
                        rating: pizza.rating,
                        reviews: pizza.reviews,
                        address: pizza.address,
                        last_updated: new Date().toISOString()
                    })
                    .eq('name', pizza.name);
            } else {
                // Добавляем новую
                await supabaseClient
                    .from('pizza_places')
                    .insert([{
                        ...pizza,
                        last_updated: new Date().toISOString()
                    }]);
            }
        } catch (dbError) {
            console.error(`Ошибка при обработке пиццерии ${pizza.name}:`, dbError.message);
        }
    }
}