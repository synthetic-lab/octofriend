use std::io::Read;
use std::thread;

pub(crate) type OutputThread = Option<thread::JoinHandle<String>>;

pub(crate) fn read_output_in_thread<T>(mut stream: T) -> thread::JoinHandle<String>
where
    T: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = String::new();
        let _ = stream.read_to_string(&mut output);
        output
    })
}

pub(crate) fn join_output(stdout: OutputThread, stderr: OutputThread) -> String {
    let mut output = String::new();
    if let Some(stdout) = stdout {
        output.push_str(&stdout.join().unwrap_or_default());
    }
    if let Some(stderr) = stderr {
        output.push_str(&stderr.join().unwrap_or_default());
    }
    output
}
