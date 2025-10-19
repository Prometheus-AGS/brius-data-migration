use std::env;
use std::fs;
use std::io::{self, Read};
use std::process;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <filename>", args[0]);
        eprintln!("Content will be read from stdin");
        process::exit(1);
    }
    let filename = &args[1];
    let mut content = String::new();
    io::stdin().read_to_string(&mut content).unwrap_or_else(|e| {
        eprintln!("Error reading stdin: {}", e);
        process::exit(1);
    });
    fs::write(filename, content).unwrap_or_else(|e| {
        eprintln!("Error writing file: {}", e);
        process::exit(1);
    });
    println!("✓ Created: {} ({} bytes)", filename, fs::metadata(filename).unwrap().len());
}
