const { Pool } = require("pg");

// for env variables
require('dotenv').config();

const pool = new Pool({
  user: process.env.USER,
  host: process.env.HOST,
  database: process.env.DATABASE,
  password: process.env.PASSWORD,
  port: process.env.PORT,
});

module.exports = pool;

class Database {
  constructor() {
    this.pool = pool;
    console.log("Database pool created successfully");
  }

  async get_connection(){
    try {
      const connection = await this.pool.connect();
      console.log("Database connection established successfully");
      return connection;
    }
    catch (err) {
      console.error("Error connecting to the database:", err);
      throw err;
    }
  }

  async insert_data(query, values) {
    const connection = await this.get_connection();
    try {
      const result = await connection.query(query, values);
      console.log("Data inserted successfully:", result);
      return result;
    }
    catch (err) {
      console.error("Error inserting data into the database:", err);
    //   throw err;
      return false;
    }
    finally {connection.release();}
    }

    async update_data(query, values) {
        const connection = await this.get_connection();
        try {  
            const result = await connection.query(query, values);
            return result;
        }
        catch (err) {
            console.error("Error updating data in the database:", err);
            return false;
        }
        finally {connection.release();}
    }
    async fetch_data(query, values) {
        const connection = await this.get_connection();
        try {
            const result = await connection.query(query, values);
            return result.rows;
        }
        catch (err) {
            console.error("Error fetching data from the database:", err);
            return false;
        }
        finally {connection.release();}
    }
    async fetch_all_data(query, values) {
        const connection = await this.get_connection();
        try { 
        const result = await connection.query(query, values);
        return result.rows;
        } 
        catch (err) {
            console.error("Error fetching all data from the database:", err);
            return false;
        }       
        finally {connection.release();}
    }

    async fetchdatawithoutvalue(query) {
        const connection = await this.get_connection();
        try {    
        const result = await connection.query(query);
        return result.rows;
        }
        catch (err) {
            console.error("Error fetching data without value from the database:", err);
            return false;
        }
        finally {connection.release();}
    }

    async delete_data(query, values) {
        const connection = await this.get_connection();
        try {  
        const result = await connection.query(query, values);
        return result;
        }
        catch (err) {
            console.error("Error deleting data from the database:", err);
            return false;
        }
        finally {connection.release();}
    }
  
}

module.exports = Database;